//! Terminal modes set by output that the scrollback has dropped.
//!
//! Programs switch terminal modes with escape sequences, such as `CSI ? 1049 h`
//! for the alternate screen. Once the scrollback drops the bytes that set a
//! mode, a replay no longer carries it. [`ModeTracker`] reads the dropped bytes
//! in order and builds the sequences that put a fresh terminal back into the
//! same modes, which the scrollback sends ahead of each replay.

/// DEC private modes the tracker follows as on or off flags, with their
/// power-on state. DECSTR returns every one of them to that state.
const FLAGS: [(u16, bool); 5] = [
    (1, false),    // Application cursor keys.
    (7, true),     // Autowrap.
    (25, true),    // Visible cursor.
    (1004, false), // Focus reports.
    (2004, false), // Bracketed paste.
];

/// Modes that select one screen buffer. As in xterm.js, setting any of them
/// shows the alternate screen and resetting any of them leaves it.
const ALTERNATE_SCREEN: [u16; 3] = [47, 1047, 1049];

/// Mouse tracking protocols: X10, button, drag and any motion. xterm.js keeps
/// one active protocol, so setting one replaces the last and resetting any of
/// them turns tracking off.
const MOUSE_PROTOCOLS: [u16; 4] = [9, 1000, 1002, 1003];

/// Mouse encodings xterm.js supports: SGR and SGR pixels. As with the
/// protocols, one is active and resetting either restores the default. xterm.js
/// ignores the UTF-8 (1005) and urxvt (1015) encodings, so the tracker does too.
const MOUSE_ENCODINGS: [u16; 2] = [1006, 1016];

/// Parameters kept from one control sequence. Longer sequences are ignored,
/// which keeps the tracker's memory fixed.
const MAX_PARAMS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Ground,
    Escape,
    /// Inside a control sequence that may set or reset modes.
    Csi,
    /// After `CSI !`, which a final `p` makes a soft terminal reset (DECSTR).
    SoftReset,
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
    /// Whether the sequence has a parameter byte yet. A `?` counts as the
    /// private marker only before the first one.
    started: bool,
    params: [u16; MAX_PARAMS],
    count: usize,
    flags: [bool; FLAGS.len()],
    alternate_screen: Option<u16>,
    mouse_protocol: Option<u16>,
    mouse_encoding: Option<u16>,
    application_keypad: bool,
}

impl Default for ModeTracker {
    fn default() -> Self {
        Self {
            state: State::Ground,
            private: false,
            started: false,
            params: [0; MAX_PARAMS],
            count: 1,
            flags: FLAGS.map(|(_, default)| default),
            alternate_screen: None,
            mouse_protocol: None,
            mouse_encoding: None,
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
                        self.started = false;
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
                b'?' if !self.started && !self.private => self.private = true,
                b'0'..=b'9' => {
                    self.started = true;
                    let param = &mut self.params[self.count - 1];
                    *param = param
                        .saturating_mul(10)
                        .saturating_add(u16::from(byte - b'0'));
                }
                b';' if self.count < MAX_PARAMS => {
                    self.started = true;
                    self.count += 1;
                }
                // xterm.js runs DECSTR for `CSI ! p` with any parameters, but
                // not after a private marker.
                b'!' if !self.private => self.state = State::SoftReset,
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
            State::SoftReset if byte == b'p' => {
                self.soft_reset();
                self.state = State::Ground;
            }
            State::SoftReset => match byte {
                0x40..=0x7e | 0x18 | 0x1a => self.state = State::Ground,
                0x00..=0x1f => {}
                // A second intermediate or a parameter makes another sequence.
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
        for &param in &self.params[..self.count] {
            let selected = set.then_some(param);
            if ALTERNATE_SCREEN.contains(&param) {
                self.alternate_screen = selected;
            } else if MOUSE_PROTOCOLS.contains(&param) {
                self.mouse_protocol = selected;
            } else if MOUSE_ENCODINGS.contains(&param) {
                self.mouse_encoding = selected;
            } else if let Some(index) = FLAGS.iter().position(|(mode, _)| *mode == param) {
                self.flags[index] = set;
            }
        }
    }

    /// Applies DECSTR as xterm.js does. Its soft reset returns every tracked
    /// flag and the keypad to their power-on state, and leaves the alternate
    /// screen and mouse tracking alone.
    fn soft_reset(&mut self) {
        self.flags = FLAGS.map(|(_, default)| default);
        self.application_keypad = false;
    }

    /// Returns the sequences that move a terminal from its power-on state into
    /// the tracked modes. Empty when every mode is at its power-on state.
    ///
    /// The alternate screen comes first, because entering it must happen
    /// before the replay draws on it.
    pub(crate) fn restore(&self) -> Vec<u8> {
        let mut sequences = Vec::new();
        let mut push = |mode: u16, set: bool| {
            let action = if set { 'h' } else { 'l' };
            sequences.extend(format!("\x1b[?{mode}{action}").into_bytes());
        };
        if let Some(mode) = self.alternate_screen {
            push(mode, true);
        }
        for ((mode, default), &set) in FLAGS.iter().zip(&self.flags) {
            if set != *default {
                push(*mode, set);
            }
        }
        for mode in [self.mouse_protocol, self.mouse_encoding]
            .into_iter()
            .flatten()
        {
            push(mode, true);
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
            "\x1b[?1049h\x1b[?1h\x1b[?25l\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b="
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
    fn soft_reset_resets_flags_and_keypad_but_not_screen_or_mouse() {
        let stream = b"\x1b[?1049h\x1b[?1000h\x1b[?25l\x1b[?7l\x1b[?1h\x1b=\x1b[?1004;2004h\x1b[!p";
        assert_eq!(restored(stream), "\x1b[?1049h\x1b[?1000h");
        // Split across feeds, and with parameters.
        let mut tracker = ModeTracker::default();
        for part in [&b"\x1b[?25l\x1b["[..], b"5!", b"p"] {
            tracker.feed(part.iter().copied());
        }
        assert_eq!(tracker.restore(), b"");
        // A private marker or another intermediate makes another sequence.
        for stream in [
            &b"\x1b[?25l\x1b[\"p"[..],
            b"\x1b[?25l\x1b[?!p",
            b"\x1b[?25l\x1b[!\"p",
        ] {
            assert_eq!(restored(stream), "\x1b[?25l", "{stream:?}");
        }
    }

    #[test]
    fn keeps_one_mouse_protocol_and_one_encoding() {
        // Resetting any protocol turns tracking off.
        assert_eq!(restored(b"\x1b[?1000h\x1b[?1003h\x1b[?1003l"), "");
        // The last protocol set wins.
        assert_eq!(restored(b"\x1b[?1003h\x1b[?1000h"), "\x1b[?1000h");
        assert_eq!(
            restored(b"\x1b[?1006h\x1b[?1016h\x1b[?1015h"),
            "\x1b[?1016h"
        );
        assert_eq!(restored(b"\x1b[?1016h\x1b[?1006l"), "");
        // `?` counts as the private marker only as the first byte.
        assert_eq!(restored(b"\x1b[0?1003h"), "");
        assert_eq!(restored(b"\x1b[??1003h"), "");
    }

    #[test]
    fn keeps_one_alternate_screen() {
        assert_eq!(restored(b"\x1b[?1049h\x1b[?47l"), "");
        assert_eq!(restored(b"\x1b[?47h\x1b[?1049h"), "\x1b[?1049h");
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
