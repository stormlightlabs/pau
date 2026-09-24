use std::{io, net::SocketAddr};

use axum::{Json, Router, routing::get};
use pau_core::VersionResponse;
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};
use tower_http::cors::CorsLayer;

/// Version returned by every Pau backend implementation.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Builds the shared HTTP API used by desktop and browser clients.
pub fn router() -> Router {
    Router::new()
        .route("/api/version", get(version))
        .layer(CorsLayer::permissive())
}

async fn version() -> Json<VersionResponse> {
    Json(VersionResponse {
        version: VERSION.to_owned(),
    })
}

/// A running local server and its graceful-shutdown signal.
#[derive(Debug)]
pub struct ServerHandle {
    address: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    task: Option<JoinHandle<io::Result<()>>>,
}

impl ServerHandle {
    /// Returns the loopback address selected by the operating system.
    pub fn local_addr(&self) -> SocketAddr {
        self.address
    }

    /// Starts graceful shutdown without waiting for the listener task.
    pub fn request_shutdown(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
    }

    /// Stops the server and waits for its listener task.
    pub async fn shutdown(mut self) -> io::Result<()> {
        self.request_shutdown();
        self.task
            .take()
            .expect("server task is present until shutdown")
            .await
            .map_err(io::Error::other)?
    }
}

impl Drop for ServerHandle {
    fn drop(&mut self) {
        self.request_shutdown();
    }
}

/// Starts the shared API on the requested address.
///
/// Pass port `0` to let the operating system choose an unused port.
pub async fn start(address: SocketAddr) -> io::Result<ServerHandle> {
    if !address.ip().is_loopback() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the local Pau server must bind to a loopback address",
        ));
    }

    let listener = TcpListener::bind(address).await?;
    let address = listener.local_addr()?;
    let (shutdown, shutdown_receiver) = oneshot::channel();
    let task = tokio::spawn(
        axum::serve(listener, router())
            .with_graceful_shutdown(async move {
                let _ = shutdown_receiver.await;
            })
            .into_future(),
    );

    Ok(ServerHandle {
        address,
        shutdown: Some(shutdown),
        task: Some(task),
    })
}

#[cfg(test)]
mod tests {
    use std::{net::Ipv4Addr, time::Duration};

    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
        time::timeout,
    };

    use super::*;

    async fn version_response(address: SocketAddr) -> String {
        let mut stream = TcpStream::connect(address).await.unwrap();
        stream
            .write_all(b"GET /api/version HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        response
    }

    #[tokio::test]
    async fn serves_version_on_an_ephemeral_loopback_port() {
        let server = start((Ipv4Addr::LOCALHOST, 0).into()).await.unwrap();

        assert!(server.local_addr().ip().is_loopback());
        assert_ne!(server.local_addr().port(), 0);
        let response = version_response(server.local_addr()).await;
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.ends_with(&format!("{{\"version\":\"{VERSION}\"}}")));

        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn shutdown_closes_the_listener() {
        let server = start((Ipv4Addr::LOCALHOST, 0).into()).await.unwrap();
        let address = server.local_addr();

        server.shutdown().await.unwrap();

        assert!(
            timeout(Duration::from_secs(1), TcpStream::connect(address))
                .await
                .unwrap()
                .is_err()
        );
    }

    #[tokio::test]
    async fn rejects_non_loopback_addresses() {
        let error = start((Ipv4Addr::UNSPECIFIED, 0).into()).await.unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }
}
