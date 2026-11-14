//! Terminal modes set by output that the scrollback has dropped.
//!
//! Programs switch terminal modes with escape sequences, such as `CSI ? 1049 h`
//! for the alternate screen. Once the scrollback drops the bytes that set a
//! mode, a replay no longer carries it. [`ModeTracker`] reads the dropped bytes
//! in order and builds the sequences that put a fresh terminal back into the
//! same modes, which the scrollback sends ahead of each replay.

/// DEC private modes the tracker follows, with their power-on state.
///
/// The alternate screen modes come first, because entering the alternate
/// screen must happen before the replay draws on it.
const MODES: [(u16, bool); 14] = [
    (47, false),   // Alternate screen.
    (1047, false), // Alternate screen, cleared on exit.
    (1049, false), // Alternate screen with saved cursor.
    (1, false),    // Application cursor keys.
    (7, true),     // Autowrap.
    (25, true),    // Visible cursor.
    (1000, false), // Mouse button reports.
    (1002, false), // Mouse drag reports.
    (1003, false), // Mouse motion reports.
    (1004, false), // Focus reports.
    (1005, false), // UTF-8 mouse encoding.
    (1006, false), // SGR mouse encoding.
    (1015, false), // urxvt mouse encoding.
    (2004, false), // Bracketed paste.
];

/// Parameters kept from one control sequence. Longer sequences are ignored,
/// which keeps the tracker's memory fixed.
const MAX_PARAMS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Ground,
    Escape,
    /// Inside a control sequence that may set or reset modes.
    Csi,
    /// Inside a control sequence the tracker does not act on, until its final
    /// byte.
    Ignore,
}

/// Follows the DEC private modes and keypad mode that a byte stream sets.
///
/// Bytes must arrive in stream order, but may split a sequence anywhere.
#[derive(Debug, Clone)]
pub(crate) struct ModeTracker {
    state: State,
    private: bool,
    params: [u16; MAX_PARAMS],
    count: usize,
    modes: [bool; MODES.len()],
    application_keypad: bool,
}

impl Default for ModeTracker {
    fn default() -> Self {
        Self {
            state: State::Ground,
            private: false,
            params: [0; MAX_PARAMS],
            count: 1,
            modes: MODES.map(|(_, default)| default),
            application_keypad: false,
        }
    }
}

impl ModeTracker {
    /// Reads the next bytes of the stream.
    pub(crate) fn feed(&mut self, bytes: impl IntoIterator<Item = u8>) {
        for byte in bytes {
            self.step(byte);
        }
    }

    fn step(&mut self, byte: u8) {
        if byte == 0x1b {
            self.state = State::Escape;
            return;
        }
        match self.state {
            State::Ground => {}
            State::Escape => {
                self.state = State::Ground;
                match byte {
                    b'[' => {
                        self.state = State::Csi;
                        self.private = false;
                        self.params = [0; MAX_PARAMS];
                        self.count = 1;
                    }
                    // Full reset.
                    b'c' => *self = Self::default(),
                    b'=' => self.application_keypad = true,
                    b'>' => self.application_keypad = false,
                    _ => {}
                }
            }
            State::Csi => match byte {
                b'?' if self.count == 1 && self.params[0] == 0 && !self.private => {
                    self.private = true;
                }
                b'0'..=b'9' => {
                    let param = &mut self.params[self.count - 1];
                    *param = param
                        .saturating_mul(10)
                        .saturating_add(u16::from(byte - b'0'));
                }
                b';' if self.count < MAX_PARAMS => self.count += 1,
                b'h' | b'l' => {
                    if self.private {
                        self.apply(byte == b'h');
                    }
                    self.state = State::Ground;
                }
                0x40..=0x7e => self.state = State::Ground,
                // Cancel and substitute abort the sequence.
                0x18 | 0x1a => self.state = State::Ground,
                // Other C0 controls run inside a sequence without ending it.
                0x00..=0x1f => {}
                _ => self.state = State::Ignore,
            },
            State::Ignore => {
                if (0x40..=0x7e).contains(&byte) || byte == 0x18 || byte == 0x1a {
                    self.state = State::Ground;
                }
            }
        }
    }

    fn apply(&mut self, set: bool) {
        for param in &self.params[..self.count] {
            if let Some(index) = MODES.iter().position(|(mode, _)| mode == param) {
                self.modes[index] = set;
            }
        }
    }

    /// Returns the sequences that move a terminal from its power-on state into
    /// the tracked modes. Empty when every mode is at its power-on state.
    pub(crate) fn restore(&self) -> Vec<u8> {
        let mut sequences = Vec::new();
        for ((mode, default), &set) in MODES.iter().zip(&self.modes) {
            if set != *default {
                let action = if set { 'h' } else { 'l' };
                sequences.extend(format!("\x1b[?{mode}{action}").into_bytes());
            }
        }
        if self.application_keypad {
            sequences.extend(b"\x1b=");
        }
        sequences
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn restored(stream: &[u8]) -> String {
        let mut tracker = ModeTracker::default();
        tracker.feed(stream.iter().copied());
        String::from_utf8(tracker.restore()).unwrap()
    }

    #[test]
    fn restores_nothing_for_plain_output() {
        assert_eq!(restored(b"\x1b[1;31mred\x1b[0m\r\n\x1b[2J\x1b[H"), "");
    }

    #[test]
    fn restores_modes_a_full_screen_program_set() {
        let stream = b"\x1b[?1049h\x1b[?1h\x1b=\x1b[?25l\x1b[?1000;1006h\x1b[?2004h";
        assert_eq!(
            restored(stream),
            "\x1b[?1049h\x1b[?1h\x1b[?25l\x1b[?1000h\x1b[?1006h\x1b[?2004h\x1b="
        );
    }

    #[test]
    fn follows_later_resets_and_a_full_reset() {
        assert_eq!(
            restored(b"\x1b[?1049h\x1b[?2004htext\x1b[?1049l"),
            "\x1b[?2004h"
        );
        assert_eq!(restored(b"\x1b[?1049h\x1b=\x1bc\x1b[?7l"), "\x1b[?7l");
    }

    #[test]
    fn reads_sequences_split_across_feeds() {
        let mut tracker = ModeTracker::default();
        for part in [&b"out\x1b"[..], b"[?10", b"49", b"h"] {
            tracker.feed(part.iter().copied());
        }
        assert_eq!(tracker.restore(), b"\x1b[?1049h");
    }

    #[test]
    fn ignores_sequences_that_are_not_private_mode_changes() {
        // Standard mode 4 (insert), a sequence with an intermediate byte, an
        // aborted sequence and an overlong parameter list.
        let mut overlong = b"\x1b[?".to_vec();
        overlong.extend((0..40).flat_map(|_| *b"1;"));
        overlong.extend(b"2004h");
        for stream in [
            &b"\x1b[4h"[..],
            b"\x1b[?1049$h",
            b"\x1b[?1049\x18h",
            &overlong,
        ] {
            assert_eq!(restored(stream), "", "{stream:?}");
        }
    }
}
