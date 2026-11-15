//! The gate that refuses process starts once shutdown begins.
//!
//! Shutdown aborts the listener, but connection tasks axum has already
//! spawned keep running. Without the gate, a start request that stalled
//! until after the stops ran could still launch an agent or a terminal that
//! nothing stops, and it would outlive Pau.

use std::{future::Future, sync::Arc};

use tokio::sync::watch;

use crate::ApiError;

/// Every route that starts a long-lived process runs its start through
/// [`StartGate::run`]: session start and terminal open. Other routes launch
/// only short probes with their own time limits, such as discovery and Git.
///
/// The contract with [`crate::ServerHandle::shutdown`]:
///
/// - Shutdown calls [`StartGate::close`] before it stops the listener. A
///   start that arrives later is refused with `503 shutting_down` before it
///   launches anything.
/// - Shutdown waits for [`StartGate::settled`] before it takes the session
///   and terminal registries. A start already in flight finishes first, so
///   the process it launched is registered and the stops reach it.
/// - A start still in flight at the kill deadline is cancelled, which drops
///   the process it launched. Agent and terminal handles kill their process
///   group when dropped, within the grace shutdown leaves before its drain.
#[derive(Clone, Debug)]
pub(crate) struct StartGate(Arc<watch::Sender<GateState>>);

#[derive(Clone, Copy, Debug, Default)]
struct GateState {
    closed: bool,
    /// Set when shutdown stops waiting for the starts in flight.
    cancelled: bool,
    /// Starts that passed the gate and have not yet returned or been dropped.
    in_flight: usize,
}

impl Default for StartGate {
    fn default() -> Self {
        Self(Arc::new(watch::Sender::new(GateState::default())))
    }
}

impl StartGate {
    /// Runs `start` unless shutdown has begun. A start that shutdown has
    /// to cancel, or that arrives after it began, is `503 shutting_down`.
    pub(crate) async fn run<T, E: From<ApiError>>(
        &self,
        start: impl Future<Output = Result<T, E>>,
    ) -> Result<T, E> {
        let mut entered = false;
        self.0.send_if_modified(|state| {
            entered = !state.closed;
            state.in_flight += usize::from(entered);
            entered
        });
        if !entered {
            return Err(ApiError::ShuttingDown.into());
        }
        let _in_flight = InFlight(self);
        let mut gate = self.0.subscribe();
        tokio::select! {
            biased;
            () = async {
                let _ = gate.wait_for(|state| state.cancelled).await;
            } => Err(ApiError::ShuttingDown.into()),
            result = start => result,
        }
    }

    /// Refuses every later start.
    pub(crate) fn close(&self) {
        self.0.send_modify(|state| state.closed = true);
    }

    /// Waits until no start that passed the gate is still running, and
    /// cancels the ones still running at `kill_at`.
    pub(crate) async fn settled(&self, kill_at: tokio::time::Instant) {
        let mut gate = self.0.subscribe();
        let idle = tokio::time::timeout_at(kill_at, async {
            let _ = gate.wait_for(|state| state.in_flight == 0).await;
        })
        .await;
        if idle.is_err() {
            self.0.send_modify(|state| state.cancelled = true);
            let _ = gate.wait_for(|state| state.in_flight == 0).await;
        }
    }
}

/// Counts one start in flight until it returns or is dropped.
struct InFlight<'a>(&'a StartGate);

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        self.0.0.send_modify(|state| state.in_flight -= 1);
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    /// A start that never finishes must not hold shutdown past its kill
    /// deadline.
    #[tokio::test(start_paused = true)]
    async fn cancels_a_start_still_running_at_the_kill_deadline() {
        let gate = StartGate::default();
        let start = tokio::spawn({
            let gate = gate.clone();
            async move {
                gate.run(std::future::pending::<Result<(), ApiError>>())
                    .await
            }
        });
        tokio::task::yield_now().await;
        gate.close();

        gate.settled(tokio::time::Instant::now() + Duration::from_secs(1))
            .await;

        assert!(matches!(start.await.unwrap(), Err(ApiError::ShuttingDown)));
        assert!(matches!(
            gate.run(async { Ok::<(), ApiError>(()) }).await,
            Err(ApiError::ShuttingDown)
        ));
    }
}
