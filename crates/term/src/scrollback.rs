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

use crate::{TerminalOutput, modes::ModeTracker};

/// Output bytes a terminal keeps for replay.
///
/// The limit counts bytes rather than lines, so memory stays at 1 MiB per
/// terminal however long its lines are. That holds about 10,000 lines of
/// 100 plain characters, fewer when output carries colors and other escape
/// sequences. When output passes the limit, the oldest bytes are dropped first.
///
/// After a cut, the scrollback also drops bytes up to and including the first
/// newline, so a replay starts at the beginning of a line rather than inside
/// an escape sequence or a UTF-8 character. When the first
/// [`LINE_SEARCH_BYTES`] retained bytes hold no newline, as with full-screen
/// programs and very long lines, it drops only up to the next UTF-8 character
/// boundary, and the replay can still start inside an escape sequence.
///
/// A replay holds output bytes, not the whole terminal state. It starts with
/// the sequences that restore the modes the dropped output had set, such as
/// the alternate screen, cursor keys, mouse tracking and bracketed paste, so a
/// view that reattaches to a full-screen program after a cut still draws on
/// the right screen and receives the mouse. Colors, the scroll region and the
/// screen contents the dropped output drew are not restored.
pub const SCROLLBACK_BYTES: usize = 1024 * 1024;

/// Bytes searched for a newline after a cut before the scrollback settles for
/// a UTF-8 character boundary.
const LINE_SEARCH_BYTES: usize = 4 * 1024;

/// Output chunks an attached view may fall behind before it receives
/// [`AttachedOutput::Lagged`].
///
/// The terminal never waits for a view, so a slow view loses its live output
/// instead of stalling the child or growing server memory.
pub const LIVE_CHUNKS: usize = 256;

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
    /// Modes set by the output dropped from `retained`.
    dropped_modes: ModeTracker,
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
            dropped_modes: ModeTracker::default(),
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
    ///
    /// Once more than [`SCROLLBACK_BYTES`] of output has been written, the
    /// replay starts with the sequences that restore the terminal modes the
    /// dropped output set, as [`SCROLLBACK_BYTES`] describes.
    pub fn attach(&self) -> TerminalAttachment {
        let shared = self.0.lock().expect("terminal scrollback lock poisoned");
        let (front, back) = shared.retained.as_slices();
        let modes = shared.dropped_modes.restore();
        TerminalAttachment {
            replay: Bytes::from([&modes, front, back].concat()),
            live: shared.live.as_ref().map(broadcast::Sender::subscribe),
        }
    }

    fn push(&self, chunk: Vec<u8>) {
        let mut guard = self.0.lock().expect("terminal scrollback lock poisoned");
        let shared = &mut *guard;
        let limit = shared.limit;
        let cut = shared.retained.len() + chunk.len() > limit;
        let kept = &chunk[chunk.len().saturating_sub(limit)..];
        let overflow = (shared.retained.len() + kept.len()).saturating_sub(limit);
        // The last byte the cut drops, which comes from the chunk itself when
        // the chunk alone exceeds the limit.
        let dropped = if kept.len() < chunk.len() {
            chunk.get(chunk.len() - kept.len() - 1).copied()
        } else {
            overflow.checked_sub(1).map(|last| shared.retained[last])
        };
        // Dropped bytes reach the mode tracker in stream order: the oldest
        // retained bytes, then any part of the chunk beyond the limit, then
        // the partial line before the new replay start.
        shared.dropped_modes.feed(shared.retained.drain(..overflow));
        shared
            .dropped_modes
            .feed(chunk[..chunk.len() - kept.len()].iter().copied());
        shared.retained.extend(kept);
        // A cut right after a newline already leaves the replay on a line
        // start.
        if cut && dropped != Some(b'\n') {
            let start = replay_start(&shared.retained);
            shared.dropped_modes.feed(shared.retained.drain(..start));
        }
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

/// Returns how many leading bytes to drop after a cut so that a replay starts
/// on a line boundary, or failing that on a UTF-8 character boundary.
///
/// A UTF-8 character has at most three continuation bytes, so the fallback
/// drops at most three bytes and never empties the scrollback.
fn replay_start(retained: &VecDeque<u8>) -> usize {
    retained
        .iter()
        .take(LINE_SEARCH_BYTES)
        .position(|&byte| byte == b'\n')
        .map_or_else(
            || {
                retained
                    .iter()
                    .take(3)
                    .take_while(|&&byte| byte & 0xC0 == 0x80)
                    .count()
            },
            |newline| newline + 1,
        )
}

/// One view's connection to a terminal's output. Dropping it detaches the
/// view; the terminal keeps running and retaining output.
#[derive(Debug)]
pub struct TerminalAttachment {
    /// Emptied by [`TerminalAttachment::take_replay`], so an attachment does
    /// not hold a second copy of the scrollback while its view stays open.
    replay: Bytes,
    live: Option<broadcast::Receiver<Bytes>>,
}

/// The next event on a [`TerminalAttachment`]'s live feed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachedOutput {
    /// Output written after the attachment's replay.
    Output(Bytes),
    /// The view fell more than [`LIVE_CHUNKS`] chunks behind and missed
    /// output. Attach again to recover from the scrollback.
    Lagged,
    /// No process holds the terminal open, so no more output will arrive.
    Ended,
}

impl TerminalAttachment {
    /// Returns the output retained when the view attached, oldest first, and
    /// releases the attachment's copy. Later calls return no bytes.
    pub fn take_replay(&mut self) -> Bytes {
        std::mem::take(&mut self.replay)
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

        assert_eq!(attachment.take_replay(), Bytes::from_static(b"before "));
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
        let mut second = scrollback.attach();
        assert_eq!(second.take_replay(), Bytes::from_static(b"seen missed"));
    }

    #[test]
    fn drops_the_oldest_output_beyond_the_limit() {
        let scrollback = TerminalScrollback::with_limit(8);
        scrollback.push(b"abcdef".to_vec());
        scrollback.push(b"ghij".to_vec());
        assert_eq!(
            scrollback.attach().take_replay(),
            Bytes::from_static(b"cdefghij")
        );

        scrollback.push(b"0123456789".to_vec());
        assert_eq!(
            scrollback.attach().take_replay(),
            Bytes::from_static(b"23456789")
        );
    }

    #[test]
    fn starts_the_replay_after_the_first_newline_once_output_is_cut() {
        let scrollback = TerminalScrollback::with_limit(16);
        scrollback.push(b"\x1b[38;5;196mred\nnext\n".to_vec());
        scrollback.push(b"more".to_vec());
        assert_eq!(
            scrollback.attach().take_replay(),
            Bytes::from_static(b"next\nmore")
        );
    }

    #[test]
    fn keeps_the_next_line_when_the_cut_falls_on_a_line_start() {
        let scrollback = TerminalScrollback::with_limit(10);
        for line in [b"aaaa\n", b"bbbb\n", b"cccc\n"] {
            scrollback.push(line.to_vec());
        }
        assert_eq!(
            scrollback.attach().take_replay(),
            Bytes::from_static(b"bbbb\ncccc\n")
        );

        // The same holds when one chunk alone exceeds the limit.
        let scrollback = TerminalScrollback::with_limit(10);
        scrollback.push(b"aaaa\nbbbb\ncccc\n".to_vec());
        assert_eq!(
            scrollback.attach().take_replay(),
            Bytes::from_static(b"bbbb\ncccc\n")
        );
    }

    #[test]
    fn releases_the_replay_once_taken() {
        let scrollback = TerminalScrollback::with_limit(64);
        scrollback.push(b"output".to_vec());
        let mut attachment = scrollback.attach();

        let replay = attachment.take_replay();
        assert_eq!(replay, Bytes::from_static(b"output"));
        assert!(replay.is_unique());
        assert!(attachment.take_replay().is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn delivers_each_chunk_once_to_views_attaching_during_output() {
        const CHUNKS: usize = LIVE_CHUNKS - 1;
        const VIEWS_PER_THREAD: usize = 64;
        let scrollback = TerminalScrollback::with_limit(SCROLLBACK_BYTES);
        let start = Arc::new(std::sync::Barrier::new(5));

        let attachers: Vec<_> = (0..4)
            .map(|_| {
                let scrollback = scrollback.clone();
                let start = Arc::clone(&start);
                std::thread::spawn(move || {
                    start.wait();
                    (0..VIEWS_PER_THREAD)
                        .map(|_| {
                            std::thread::yield_now();
                            scrollback.attach()
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        start.wait();
        let mut expected = Vec::new();
        for index in 0..CHUNKS {
            let chunk = format!("{index};").into_bytes();
            expected.extend(&chunk);
            scrollback.push(chunk);
            std::thread::yield_now();
        }
        scrollback.end();

        for attacher in attachers {
            for mut attachment in attacher.join().expect("attacher panicked") {
                let mut received = attachment.take_replay().to_vec();
                loop {
                    match attachment.recv().await {
                        AttachedOutput::Output(chunk) => received.extend(&chunk),
                        AttachedOutput::Ended => break,
                        AttachedOutput::Lagged => panic!("view lagged"),
                    }
                }
                assert_eq!(
                    String::from_utf8(received).unwrap(),
                    String::from_utf8(expected.clone()).unwrap()
                );
            }
        }
    }

    #[test]
    fn starts_the_replay_on_a_character_boundary_without_a_newline() {
        let scrollback = TerminalScrollback::with_limit(5);
        // The cut leaves the continuation byte of the second `é`.
        scrollback.push("éééé".as_bytes().to_vec());
        assert_eq!(scrollback.attach().take_replay(), "éé".as_bytes());

        // The only newline lies past the search window, so it is kept.
        let mut long_line = vec![b'x'; LINE_SEARCH_BYTES];
        long_line.extend(b"\ny");
        let scrollback = TerminalScrollback::with_limit(long_line.len());
        scrollback.push(b"x".to_vec());
        scrollback.push(long_line.clone());
        assert_eq!(scrollback.attach().take_replay(), long_line);
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
        assert_eq!(later.take_replay(), Bytes::from_static(b"last"));
        assert_eq!(later.recv().await, AttachedOutput::Ended);
    }

    #[test]
    fn restores_modes_set_by_dropped_output_before_the_replay() {
        let scrollback = TerminalScrollback::with_limit(16);
        scrollback.push(b"\x1b[?1049h\x1b[?2004hscreen\n".to_vec());
        scrollback.push(b"\x1b[?2004l".to_vec());
        scrollback.push(b"line one\nline two\n".to_vec());
        assert_eq!(
            scrollback.attach().take_replay(),
            Bytes::from_static(b"\x1b[?1049hline two\n")
        );
    }

    #[tokio::test]
    async fn keeps_memory_bounded_while_a_view_stops_reading() {
        let scrollback = TerminalScrollback::with_limit(64 * 1024);
        let mut idle = scrollback.attach();
        for _ in 0..LIVE_CHUNKS * 8 {
            scrollback.push(vec![b'y'; 8 * 1024]);
        }
        assert!(scrollback.0.lock().unwrap().retained.len() <= 64 * 1024);
        // The idle view lost the oldest chunks, and only the newest
        // `LIVE_CHUNKS` are still held for it.
        assert_eq!(idle.recv().await, AttachedOutput::Lagged);
        let live = idle.live.as_mut().unwrap();
        let mut held = 0;
        while live.try_recv().is_ok() {
            held += 1;
        }
        assert_eq!(held, LIVE_CHUNKS);
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
