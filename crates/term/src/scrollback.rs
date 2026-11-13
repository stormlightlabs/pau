//! Terminal output that outlives the views watching it.
//!
//! A [`TerminalScrollback`] reads a terminal's output whether or not a view is
//! attached. It keeps the most recent output in memory and forwards new output
//! to every attached view. A view attaches with [`TerminalScrollback::attach`]
//! and detaches by dropping the [`TerminalAttachment`].

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use bytes::Bytes;
use tokio::sync::broadcast;

use crate::TerminalOutput;

/// Output bytes a terminal keeps for replay.
///
/// The limit counts bytes rather than lines, so memory stays at 1 MiB per
/// terminal however long its lines are. That holds about 10,000 lines of
/// 100 plain characters, fewer when output carries colors and other escape
/// sequences. When output passes the limit, the oldest bytes are dropped first. The cut ignores character
/// and escape sequence boundaries, so a replay can start partway through one.
pub const SCROLLBACK_BYTES: usize = 1024 * 1024;

/// Output chunks an attached view may fall behind before it receives
/// [`AttachedOutput::Lagged`].
///
/// The terminal never waits for a view, so a slow view loses its live output
/// instead of stalling the child or growing server memory.
const LIVE_CHUNKS: usize = 256;

/// Recent output of one terminal and the live feed to its attached views.
///
/// Clones share the same scrollback.
#[derive(Debug, Clone)]
pub struct TerminalScrollback(Arc<Mutex<Shared>>);

#[derive(Debug)]
struct Shared {
    /// The last `limit` bytes of output, oldest first.
    retained: VecDeque<u8>,
    limit: usize,
    /// Live feed to attached views, cleared at end of output so that every
    /// attachment observes the end.
    ///
    /// Output is retained and sent while the lock is held, and [`attach`]
    /// copies the retained bytes and subscribes under the same lock. Each
    /// chunk therefore reaches an attachment exactly once, in its replay or in
    /// its live feed.
    ///
    /// [`attach`]: TerminalScrollback::attach
    live: Option<broadcast::Sender<Bytes>>,
}

impl TerminalScrollback {
    /// Reads `output` on a Tokio task until it ends, keeping the last
    /// [`SCROLLBACK_BYTES`] bytes.
    ///
    /// The task holds no reference to the terminal, so dropping the terminal
    /// still stops its child, which ends the output and the task.
    pub fn follow(mut output: TerminalOutput) -> Self {
        let scrollback = Self::with_limit(SCROLLBACK_BYTES);
        let pump = scrollback.clone();
        tokio::spawn(async move {
            while let Some(chunk) = output.recv().await {
                pump.push(chunk);
            }
            pump.end();
        });
        scrollback
    }

    fn with_limit(limit: usize) -> Self {
        let (live, _) = broadcast::channel(LIVE_CHUNKS);
        Self(Arc::new(Mutex::new(Shared {
            retained: VecDeque::new(),
            limit,
            live: Some(live),
        })))
    }

    /// Attaches a view, which receives the retained output and then live
    /// output.
    ///
    /// The replay holds all retained output, including output that earlier
    /// attachments already received, so a view should clear its screen before
    /// writing it. After output ends, an attachment still replays the retained
    /// output and then reports [`AttachedOutput::Ended`].
    pub fn attach(&self) -> TerminalAttachment {
        let shared = self.0.lock().expect("terminal scrollback lock poisoned");
        let (front, back) = shared.retained.as_slices();
        TerminalAttachment {
            replay: Bytes::from([front, back].concat()),
            live: shared.live.as_ref().map(broadcast::Sender::subscribe),
        }
    }

    fn push(&self, chunk: Vec<u8>) {
        let mut shared = self.0.lock().expect("terminal scrollback lock poisoned");
        let limit = shared.limit;
        let kept = &chunk[chunk.len().saturating_sub(limit)..];
        let overflow = (shared.retained.len() + kept.len()).saturating_sub(limit);
        shared.retained.drain(..overflow);
        shared.retained.extend(kept);
        if let Some(live) = &shared.live {
            // Sending fails only when no view is attached.
            let _ = live.send(Bytes::from(chunk));
        }
    }

    fn end(&self) {
        self.0
            .lock()
            .expect("terminal scrollback lock poisoned")
            .live
            .take();
    }
}

/// One view's connection to a terminal's output. Dropping it detaches the
/// view; the terminal keeps running and retaining output.
#[derive(Debug)]
pub struct TerminalAttachment {
    replay: Bytes,
    live: Option<broadcast::Receiver<Bytes>>,
}

/// The next event on a [`TerminalAttachment`]'s live feed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachedOutput {
    /// Output written after the attachment's replay.
    Output(Bytes),
    /// The view fell more than 256 chunks behind and missed output. Attach
    /// again to recover from the scrollback.
    Lagged,
    /// No process holds the terminal open, so no more output will arrive.
    Ended,
}

impl TerminalAttachment {
    /// Returns the output retained when the view attached, oldest first.
    pub fn replay(&self) -> Bytes {
        self.replay.clone()
    }

    /// Waits for the next live event. Live output follows the replay with no
    /// gap or overlap.
    pub async fn recv(&mut self) -> AttachedOutput {
        let Some(live) = &mut self.live else {
            return AttachedOutput::Ended;
        };
        match live.recv().await {
            Ok(chunk) => AttachedOutput::Output(chunk),
            Err(broadcast::error::RecvError::Lagged(_)) => AttachedOutput::Lagged,
            Err(broadcast::error::RecvError::Closed) => AttachedOutput::Ended,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn replays_earlier_output_then_streams_live_output_once() {
        let scrollback = TerminalScrollback::with_limit(64);
        scrollback.push(b"before ".to_vec());
        let mut attachment = scrollback.attach();
        scrollback.push(b"after".to_vec());

        assert_eq!(attachment.replay(), Bytes::from_static(b"before "));
        assert_eq!(
            attachment.recv().await,
            AttachedOutput::Output(Bytes::from_static(b"after"))
        );
    }

    #[tokio::test]
    async fn keeps_output_written_while_detached() {
        let scrollback = TerminalScrollback::with_limit(64);
        let mut first = scrollback.attach();
        scrollback.push(b"seen ".to_vec());
        assert_eq!(
            first.recv().await,
            AttachedOutput::Output(Bytes::from_static(b"seen "))
        );
        drop(first);

        scrollback.push(b"missed".to_vec());
        let second = scrollback.attach();
        assert_eq!(second.replay(), Bytes::from_static(b"seen missed"));
    }

    #[test]
    fn drops_the_oldest_output_beyond_the_limit() {
        let scrollback = TerminalScrollback::with_limit(8);
        scrollback.push(b"abcdef".to_vec());
        scrollback.push(b"ghij".to_vec());
        assert_eq!(
            scrollback.attach().replay(),
            Bytes::from_static(b"cdefghij")
        );

        scrollback.push(b"0123456789".to_vec());
        assert_eq!(
            scrollback.attach().replay(),
            Bytes::from_static(b"23456789")
        );
    }

    #[tokio::test]
    async fn reports_the_end_to_current_and_later_attachments() {
        let scrollback = TerminalScrollback::with_limit(64);
        let mut current = scrollback.attach();
        scrollback.push(b"last".to_vec());
        scrollback.end();

        assert_eq!(
            current.recv().await,
            AttachedOutput::Output(Bytes::from_static(b"last"))
        );
        assert_eq!(current.recv().await, AttachedOutput::Ended);
        let mut later = scrollback.attach();
        assert_eq!(later.replay(), Bytes::from_static(b"last"));
        assert_eq!(later.recv().await, AttachedOutput::Ended);
    }

    #[tokio::test]
    async fn reports_a_view_that_falls_behind() {
        let scrollback = TerminalScrollback::with_limit(64);
        let mut attachment = scrollback.attach();
        for _ in 0..=LIVE_CHUNKS {
            scrollback.push(b"x".to_vec());
        }
        assert_eq!(attachment.recv().await, AttachedOutput::Lagged);
    }
}
