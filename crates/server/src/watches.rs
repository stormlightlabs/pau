//! File watchers for the workspaces that clients have open.
//!
//! A client opens a workspace's files by connecting to the event stream with
//! `?watch=<workspace_id>`. The connection holds a [`WatchLease`], and the
//! workspace's watcher runs while at least one lease is alive. It stops when
//! the last client showing the workspace closes it or disconnects.

use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};

use pau_core::{
    ServerEventKind,
    workspace::WorkspaceError,
    workspace_watch::{WorkspaceFileChanges, WorkspaceWatcher},
};

use crate::{EventHub, diagnostic_timestamp};

struct ActiveWatch {
    leases: usize,
    watcher: WorkspaceWatcher,
}

/// One watcher per workspace, shared by every lease on it.
#[derive(Clone, Default)]
pub(crate) struct WorkspaceWatches(Arc<Mutex<HashMap<String, ActiveWatch>>>);

impl WorkspaceWatches {
    /// Starts watching `root` for `workspace_id`, or joins the running
    /// watcher, and publishes each batch of changes to `events`.
    pub(crate) fn acquire(
        &self,
        workspace_id: &str,
        root: &Path,
        events: &EventHub,
    ) -> Result<WatchLease, WorkspaceError> {
        let mut active = self.0.lock().expect("workspace watches lock poisoned");
        if let Some(watch) = active.get_mut(workspace_id) {
            watch.leases += 1;
        } else {
            let events = events.clone();
            let id = workspace_id.to_owned();
            let watcher = WorkspaceWatcher::start(root, move |changes: WorkspaceFileChanges| {
                events.publish(
                    diagnostic_timestamp(),
                    Some(id.clone()),
                    None,
                    ServerEventKind::WorkspaceFilesChanged,
                    serde_json::to_string(&changes).expect("file changes are serializable"),
                );
            })?;
            active.insert(workspace_id.to_owned(), ActiveWatch { leases: 1, watcher });
        }
        Ok(WatchLease {
            workspace_id: workspace_id.to_owned(),
            watches: self.clone(),
        })
    }

    #[cfg(test)]
    fn is_watching(&self, workspace_id: &str) -> bool {
        self.0
            .lock()
            .expect("workspace watches lock poisoned")
            .contains_key(workspace_id)
    }
}

/// Keeps a workspace watched until dropped.
pub(crate) struct WatchLease {
    workspace_id: String,
    watches: WorkspaceWatches,
}

impl Drop for WatchLease {
    fn drop(&mut self) {
        let stopped = {
            let mut active = self
                .watches
                .0
                .lock()
                .expect("workspace watches lock poisoned");
            let Some(watch) = active.get_mut(&self.workspace_id) else {
                return;
            };
            watch.leases -= 1;
            if watch.leases > 0 {
                return;
            }
            active.remove(&self.workspace_id)
        };
        // Stopping joins the batching thread, so do it outside the lock.
        drop(stopped.map(|watch| watch.watcher));
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, time::Duration};

    use axum::http::header;
    use futures_util::{SinkExt, StreamExt};
    use pau_core::{ServerStreamMessage, persistence::Database, workspace::WorkspaceService};
    use tokio::{net::TcpListener, time::timeout};
    use tokio_tungstenite::tungstenite::{self, client::IntoClientRequest, http::HeaderValue};

    use super::*;
    use crate::{ApiServices, ApiToken, default_diagnostics, router_with_services};

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";
    /// Upper bound for the operating system to report a change. It only
    /// turns a hang into a failure.
    const EVENT_WAIT: Duration = Duration::from_secs(10);

    #[tokio::test]
    async fn publishes_changes_until_the_last_lease_ends() {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        let events = EventHub::default();
        let mut live = events.live.subscribe();
        let watches = WorkspaceWatches::default();

        let first = watches.acquire("workspace", &root, &events).unwrap();
        let second = watches.acquire("workspace", &root, &events).unwrap();
        fs::write(root.join("notes.md"), "# Notes\n").unwrap();
        let event = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let event = live.recv().await.unwrap();
                if event.kind == ServerEventKind::WorkspaceFilesChanged {
                    return event;
                }
            }
        })
        .await
        .expect("the watcher published a change");
        assert_eq!(event.workspace_id.as_deref(), Some("workspace"));
        let changes: WorkspaceFileChanges = serde_json::from_str(&event.payload).unwrap();
        assert_eq!(changes.paths, ["notes.md"]);

        drop(first);
        assert!(watches.is_watching("workspace"));
        drop(second);
        assert!(!watches.is_watching("workspace"));
    }

    #[tokio::test]
    async fn streams_changes_while_a_watching_client_stays_connected() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(":memory:").await.unwrap();
        let workspaces = WorkspaceService::new(database.workspaces());
        let workspace = workspaces.open(directory.path(), None).await.unwrap();
        let root = workspaces.root(&workspace.id).await.unwrap();
        let events = EventHub::default();
        let app = router_with_services(
            ApiToken::configured(TOKEN).unwrap(),
            events.clone(),
            default_diagnostics(),
            ApiServices {
                workspaces: Some(workspaces),
                ..ApiServices::default()
            },
        );
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(axum::serve(listener, app).into_future());
        let connect = |watch: &str| {
            let mut request = format!("ws://{address}/api/events?watch={watch}")
                .into_client_request()
                .unwrap();
            request.headers_mut().insert(
                header::SEC_WEBSOCKET_PROTOCOL,
                HeaderValue::from_str(&format!("pau, pau.bearer.{TOKEN}")).unwrap(),
            );
            tokio_tungstenite::connect_async(request)
        };

        let unknown = connect("missing").await.unwrap_err();
        assert!(
            matches!(&unknown, tungstenite::Error::Http(response) if response.status() == 404),
            "{unknown}"
        );

        let (mut socket, _) = connect(&workspace.id).await.unwrap();
        fs::write(root.join("notes.md"), "# Notes\n").unwrap();
        let changes = timeout(EVENT_WAIT, async {
            while let Some(message) = socket.next().await {
                let tungstenite::Message::Text(text) = message.unwrap() else {
                    continue;
                };
                if let ServerStreamMessage::Event { event } = serde_json::from_str(&text).unwrap()
                    && event.kind == ServerEventKind::WorkspaceFilesChanged
                {
                    return serde_json::from_str::<WorkspaceFileChanges>(&event.payload).unwrap();
                }
            }
            panic!("the stream closed before a change arrived");
        })
        .await
        .expect("the stream delivered a change");
        assert_eq!(changes.paths, ["notes.md"]);

        // The lease lives in the stream task, which ends with the connection.
        socket
            .send(tungstenite::Message::Close(None))
            .await
            .unwrap();
        timeout(EVENT_WAIT, async {
            while events.live.receiver_count() > 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("closing the stream ended its task");
    }
}
