//! Restores the main window's saved size, position, and maximized state.
//!
//! `tauri-plugin-window-state` saves the state when the app exits and applies
//! it on request. When the saved position lies off every connected display,
//! the plugin keeps the window where it is but still applies the saved size,
//! so a window centered at the default size would end up off center. This
//! module restores the saved state only when the plugin will also restore the
//! position, and otherwise leaves the window centered at its default size.

use std::collections::HashMap;

use serde::Deserialize;
use tauri::{Manager, Monitor, Runtime, WebviewWindow};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

/// The parts of the window state Pau saves and restores. Visibility stays
/// with the shell, which shows the window once it is in place.
pub const FLAGS: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED);

/// A window or display rectangle in physical pixels.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
struct Frame {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl From<&Monitor> for Frame {
    fn from(monitor: &Monitor) -> Self {
        Self {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        }
    }
}

/// Reads the saved frame for the window `label` from the plugin's state file.
///
/// Returns `None` when the file holds no usable frame for that window. The
/// plugin records a zero-sized frame for a window it has not saved yet.
fn saved_frame(json: &str, label: &str) -> Option<Frame> {
    let mut states: HashMap<String, Frame> = serde_json::from_str(json).ok()?;
    states
        .remove(label)
        .filter(|frame| frame.width > 0 && frame.height > 0)
}

/// Returns whether any corner of `frame` lies on one of `displays`.
///
/// This matches the check the plugin makes before it moves a window, so the
/// shell restores the state exactly when the plugin restores the position.
fn is_on_display(frame: Frame, displays: &[Frame]) -> bool {
    let (left, top) = (i64::from(frame.x), i64::from(frame.y));
    let (right, bottom) = (left + i64::from(frame.width), top + i64::from(frame.height));
    let corners = [(left, top), (right, top), (left, bottom), (right, bottom)];
    displays.iter().any(|display| {
        let (x, y) = (i64::from(display.x), i64::from(display.y));
        let (width, height) = (i64::from(display.width), i64::from(display.height));
        corners
            .iter()
            .any(|&(cx, cy)| cx >= x && cx < x + width && cy >= y && cy < y + height)
    })
}

/// Applies the saved state to a hidden `window` when its saved position is on
/// a connected display, and otherwise leaves it as built.
///
/// Call this before showing the window so it never visibly moves or resizes.
pub fn restore<R: Runtime>(window: &WebviewWindow<R>) {
    let app = window.app_handle();
    let Ok(config_dir) = app.path().app_config_dir() else {
        return;
    };
    let Some(frame) = std::fs::read_to_string(config_dir.join(app.filename()))
        .ok()
        .and_then(|json| saved_frame(&json, window.label()))
    else {
        return;
    };
    let displays: Vec<Frame> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(Frame::from)
        .collect();
    if !is_on_display(frame, &displays) {
        tracing::info!("the saved window position is off every display; centering the window");
        return;
    }
    if let Err(error) = window.restore_state(FLAGS) {
        tracing::warn!(%error, "could not restore the window's size and position");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A state file as the plugin writes it after the main window was moved to
    /// a second display and resized.
    const SAVED: &str = r#"{
      "main": {
        "width": 2400,
        "height": 1500,
        "x": 3200,
        "y": 120,
        "prev_x": 3200,
        "prev_y": 120,
        "maximized": false,
        "visible": true,
        "decorated": true,
        "fullscreen": false
      }
    }"#;

    const BUILT_IN: Frame = Frame {
        x: 0,
        y: 0,
        width: 3024,
        height: 1964,
    };
    const EXTERNAL: Frame = Frame {
        x: 3024,
        y: 0,
        width: 3840,
        height: 2160,
    };

    #[test]
    fn reads_the_frame_the_plugin_saved() {
        assert_eq!(
            saved_frame(SAVED, "main"),
            Some(Frame {
                x: 3200,
                y: 120,
                width: 2400,
                height: 1500
            })
        );
    }

    #[test]
    fn ignores_a_missing_unsaved_or_unreadable_state() {
        assert_eq!(saved_frame(SAVED, "other"), None);
        assert_eq!(
            saved_frame(r#"{"main":{"width":0,"height":0,"x":0,"y":0}}"#, "main"),
            None
        );
        assert_eq!(saved_frame("not json", "main"), None);
    }

    #[test]
    fn restores_a_position_on_a_connected_display() {
        let frame = saved_frame(SAVED, "main").unwrap();
        assert!(is_on_display(frame, &[BUILT_IN, EXTERNAL]));
    }

    #[test]
    fn restores_a_window_that_overlaps_a_display() {
        let frame = Frame {
            x: -400,
            y: 200,
            width: 1440,
            height: 900,
        };
        assert!(is_on_display(frame, &[BUILT_IN]));
    }

    #[test]
    fn centers_when_the_saved_display_is_gone() {
        let frame = saved_frame(SAVED, "main").unwrap();
        assert!(!is_on_display(frame, &[BUILT_IN]));
        assert!(!is_on_display(frame, &[]));
    }
}
