//! Pi's effective key bindings.
//!
//! Pi assigns keys to named actions (`app.session.new`, `tui.input.submit`) and
//! lets the operator replace them in `<agent-dir>/keybindings.json`, as
//! described in Pi's `keybindings.md`. A configured value replaces the default
//! for that action, and an empty list unbinds it. The defaults here are the
//! ones Pi documents for macOS and Linux; the Windows and WSL variants are not
//! modelled because Pau's desktop app does not run there.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use jsonc_parser::parse_to_serde_value;
use serde_json::Value;

/// Where an action's effective keys come from.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PiKeybindingSource {
    /// Pi's built-in assignment, including "no keys".
    Default,
    /// The operator's `keybindings.json`.
    User,
}

/// One Pi action and the keys that trigger it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiKeybinding {
    /// Pi's action identifier, such as `app.session.new`.
    pub action: String,
    /// The effective keys. Empty when the action is unbound.
    pub keys: Vec<String>,
    /// Pi's built-in keys for the action. Empty for actions Pi leaves unbound
    /// and for actions that only the operator's file names.
    pub default_keys: Vec<String>,
    /// Whether `keys` is Pi's default or the operator's override.
    pub source: PiKeybindingSource,
}

/// A problem reading the operator's keybindings file.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiKeybindingWarning {
    /// The keybindings file.
    pub path: String,
    /// What is wrong, including the action when one entry is rejected.
    pub message: String,
}

/// Pi's effective key bindings for every known action.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiKeybindings {
    /// Every documented action in Pi's order, then actions only the operator's
    /// file names, in file order.
    pub bindings: Vec<PiKeybinding>,
    /// Problems that made Pau ignore the file or part of it.
    pub warnings: Vec<PiKeybindingWarning>,
}

/// Reads the keybindings file at `path` over Pi's defaults.
///
/// A missing file yields the defaults. A file that cannot be read or is not a
/// JSON object also yields the defaults, with a warning. An entry whose value
/// is not a key string or a list of key strings is skipped with a warning and
/// keeps its default.
pub fn read_pi_keybindings(path: &Path) -> PiKeybindings {
    let mut warnings = Vec::new();
    let mut warn = |message: String| {
        warnings.push(PiKeybindingWarning {
            path: path.to_string_lossy().into_owned(),
            message,
        });
    };
    let mut overrides = Vec::new();
    match fs::read_to_string(path) {
        Ok(text) => match parse_to_serde_value::<Option<Value>>(&text, &Default::default()) {
            Ok(Some(Value::Object(entries))) => {
                for (action, value) in entries {
                    match keys_from(&value) {
                        Some(keys) => overrides.push((action, keys)),
                        None => warn(format!(
                            "Ignored `{action}`: expected a key or a list of keys."
                        )),
                    }
                }
            }
            Ok(Some(_)) => warn("Ignored the file: expected a JSON object of actions.".to_owned()),
            Ok(None) | Err(_) => warn("Ignored the file: it is not valid JSON.".to_owned()),
        },
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => warn(format!("Ignored the file: {error}.")),
    }

    let mut bindings = DEFAULT_KEYBINDINGS
        .iter()
        .map(|(action, keys)| {
            let default_keys = to_owned(keys);
            PiKeybinding {
                action: (*action).to_owned(),
                keys: default_keys.clone(),
                default_keys,
                source: PiKeybindingSource::Default,
            }
        })
        .collect::<Vec<_>>();
    for (action, keys) in overrides {
        match bindings.iter_mut().find(|binding| binding.action == action) {
            Some(binding) => {
                binding.keys = keys;
                binding.source = PiKeybindingSource::User;
            }
            None => bindings.push(PiKeybinding {
                action,
                keys,
                default_keys: Vec::new(),
                source: PiKeybindingSource::User,
            }),
        }
    }
    PiKeybindings { bindings, warnings }
}

fn keys_from(value: &Value) -> Option<Vec<String>> {
    match value {
        Value::String(key) => Some(vec![key.clone()]),
        Value::Array(keys) => keys
            .iter()
            .map(|key| key.as_str().map(str::to_owned))
            .collect(),
        _ => None,
    }
}

fn to_owned(keys: &[&str]) -> Vec<String> {
    keys.iter().map(|key| (*key).to_owned()).collect()
}

/// Pi's documented actions and default keys, in the order of `keybindings.md`.
const DEFAULT_KEYBINDINGS: &[(&str, &[&str])] = &[
    ("tui.editor.cursorUp", &["up"]),
    ("tui.editor.cursorDown", &["down"]),
    ("tui.editor.historyPrevious", &[]),
    ("tui.editor.historyNext", &[]),
    ("tui.editor.cursorLeft", &["left", "ctrl+b"]),
    ("tui.editor.cursorRight", &["right", "ctrl+f"]),
    (
        "tui.editor.cursorWordLeft",
        &["alt+left", "ctrl+left", "alt+b"],
    ),
    (
        "tui.editor.cursorWordRight",
        &["alt+right", "ctrl+right", "alt+f"],
    ),
    (
        "tui.editor.cursorLineStart",
        &["home", "ctrl+home", "ctrl+a"],
    ),
    ("tui.editor.cursorLineEnd", &["end", "ctrl+end", "ctrl+e"]),
    ("tui.editor.jumpForward", &["ctrl+]"]),
    ("tui.editor.jumpBackward", &["ctrl+alt+]"]),
    ("tui.editor.pageUp", &["pageUp", "ctrl+pageUp"]),
    ("tui.editor.pageDown", &["pageDown", "ctrl+pageDown"]),
    ("tui.editor.deleteCharBackward", &["backspace"]),
    ("tui.editor.deleteCharForward", &["delete", "ctrl+d"]),
    (
        "tui.editor.deleteWordBackward",
        &["ctrl+w", "alt+backspace"],
    ),
    ("tui.editor.deleteWordForward", &["alt+d", "alt+delete"]),
    ("tui.editor.deleteToLineStart", &["ctrl+u"]),
    ("tui.editor.deleteToLineEnd", &["ctrl+k"]),
    ("tui.editor.yank", &["ctrl+y"]),
    ("tui.editor.yankPop", &["alt+y"]),
    ("tui.editor.undo", &["ctrl+-"]),
    ("tui.input.newLine", &["shift+enter", "ctrl+j"]),
    ("tui.input.submit", &["enter"]),
    ("tui.input.tab", &["tab"]),
    ("tui.input.copy", &["ctrl+c"]),
    ("tui.select.up", &["up"]),
    ("tui.select.down", &["down"]),
    ("tui.select.pageUp", &["pageUp"]),
    ("tui.select.pageDown", &["pageDown"]),
    ("tui.select.confirm", &["enter"]),
    ("tui.select.cancel", &["escape", "ctrl+c"]),
    ("tui.altScreen.pageUp", &["pageUp"]),
    ("tui.altScreen.pageDown", &["pageDown"]),
    ("tui.altScreen.halfPageUp", &[]),
    ("tui.altScreen.halfPageDown", &[]),
    ("tui.altScreen.lineUp", &[]),
    ("tui.altScreen.lineDown", &[]),
    ("tui.altScreen.previousPrompt", &["ctrl+shift+up"]),
    ("tui.altScreen.nextPrompt", &["ctrl+shift+down"]),
    ("tui.altScreen.search", &["ctrl+shift+f"]),
    ("tui.altScreen.searchNext", &["enter", "ctrl+g"]),
    (
        "tui.altScreen.searchPrevious",
        &["shift+enter", "ctrl+shift+g"],
    ),
    ("tui.altScreen.searchClose", &["escape"]),
    ("tui.altScreen.top", &["home"]),
    ("tui.altScreen.bottom", &["end"]),
    ("app.interrupt", &["escape"]),
    ("app.clear", &["ctrl+c"]),
    ("app.exit", &["ctrl+d"]),
    ("app.suspend", &["ctrl+z"]),
    ("app.editor.external", &["ctrl+g"]),
    ("app.clipboard.pasteImage", &["ctrl+v"]),
    ("app.session.new", &[]),
    ("app.session.tree", &[]),
    ("app.session.fork", &[]),
    ("app.session.resume", &[]),
    ("app.session.togglePath", &["ctrl+p"]),
    ("app.session.toggleSort", &["ctrl+s"]),
    ("app.session.toggleNamedFilter", &["ctrl+n"]),
    ("app.session.rename", &["ctrl+r"]),
    ("app.session.delete", &["ctrl+d"]),
    ("app.session.deleteNoninvasive", &["ctrl+backspace"]),
    ("app.model.select", &["ctrl+l"]),
    ("app.model.cycleForward", &["ctrl+p"]),
    ("app.model.cycleBackward", &["shift+ctrl+p"]),
    ("app.models.save", &["ctrl+s"]),
    ("app.thinking.cycle", &["shift+tab"]),
    ("app.thinking.save", &["ctrl+s"]),
    ("app.thinking.toggle", &["ctrl+t"]),
    ("app.tools.expand", &["ctrl+o"]),
    ("app.message.copy", &["ctrl+x"]),
    ("app.message.followUp", &["alt+enter"]),
    ("app.message.dequeue", &["alt+up"]),
    ("app.tree.foldOrUp", &["ctrl+left", "alt+left"]),
    ("app.tree.unfoldOrDown", &["ctrl+right", "alt+right"]),
    ("app.tree.editLabel", &["shift+l"]),
    ("app.tree.toggleLabelTimestamp", &["shift+t"]),
    ("app.tree.filter.default", &["ctrl+d"]),
    ("app.tree.filter.noTools", &["ctrl+t"]),
    ("app.tree.filter.userOnly", &["ctrl+u"]),
    ("app.tree.filter.labeledOnly", &["ctrl+l"]),
    ("app.tree.filter.all", &["ctrl+a"]),
    ("app.tree.filter.cycleForward", &["ctrl+o"]),
    ("app.tree.filter.cycleBackward", &["shift+ctrl+o"]),
    ("app.models.enableAll", &["ctrl+a"]),
    ("app.models.clearAll", &["ctrl+x"]),
    ("app.models.toggleProvider", &["ctrl+p"]),
    ("app.models.reorderUp", &["alt+up"]),
    ("app.models.reorderDown", &["alt+down"]),
];

#[cfg(test)]
mod tests {
    use super::*;

    fn read(contents: Option<&str>) -> PiKeybindings {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("keybindings.json");
        if let Some(contents) = contents {
            fs::write(&path, contents).unwrap();
        }
        read_pi_keybindings(&path)
    }

    fn find<'a>(keybindings: &'a PiKeybindings, action: &str) -> &'a PiKeybinding {
        keybindings
            .bindings
            .iter()
            .find(|binding| binding.action == action)
            .unwrap()
    }

    #[test]
    fn missing_file_yields_pi_defaults() {
        let keybindings = read(None);
        assert!(keybindings.warnings.is_empty());
        let submit = find(&keybindings, "tui.input.submit");
        assert_eq!(submit.keys, ["enter"]);
        assert_eq!(submit.source, PiKeybindingSource::Default);
        assert!(find(&keybindings, "app.session.new").keys.is_empty());
    }

    #[test]
    fn overrides_replace_defaults_and_unknown_actions_are_kept() {
        let keybindings = read(Some(
            r#"{"app.session.new": "ctrl+shift+n",
                "app.session.tree": ["ctrl+shift+t", "alt+shift+t"],
                "ext.custom": "super+k"}"#,
        ));
        assert!(keybindings.warnings.is_empty());
        let new = find(&keybindings, "app.session.new");
        assert_eq!(new.keys, ["ctrl+shift+n"]);
        assert!(new.default_keys.is_empty());
        assert_eq!(new.source, PiKeybindingSource::User);
        assert_eq!(
            find(&keybindings, "app.session.tree").keys,
            ["ctrl+shift+t", "alt+shift+t"]
        );
        let custom = keybindings.bindings.last().unwrap();
        assert_eq!(custom.action, "ext.custom");
        assert_eq!(custom.source, PiKeybindingSource::User);
        assert_eq!(find(&keybindings, "tui.input.submit").keys, ["enter"]);
    }

    #[test]
    fn empty_list_unbinds_an_action() {
        let keybindings = read(Some(r#"{"tui.altScreen.pageUp": []}"#));
        let page_up = find(&keybindings, "tui.altScreen.pageUp");
        assert!(page_up.keys.is_empty());
        assert_eq!(page_up.default_keys, ["pageUp"]);
        assert_eq!(page_up.source, PiKeybindingSource::User);
    }

    #[test]
    fn invalid_file_yields_defaults_with_a_warning() {
        for contents in ["{not json", "[1]", ""] {
            let keybindings = read(Some(contents));
            assert_eq!(keybindings.warnings.len(), 1, "{contents}");
            assert_eq!(find(&keybindings, "app.interrupt").keys, ["escape"]);
        }
    }

    #[test]
    fn invalid_entry_is_skipped_without_losing_the_rest() {
        let keybindings = read(Some(r#"{"app.exit": 5, "app.clear": ["ctrl+q"]}"#));
        assert_eq!(keybindings.warnings.len(), 1);
        assert!(keybindings.warnings[0].message.contains("app.exit"));
        assert_eq!(find(&keybindings, "app.exit").keys, ["ctrl+d"]);
        assert_eq!(find(&keybindings, "app.clear").keys, ["ctrl+q"]);
    }

    #[test]
    fn unreadable_path_yields_defaults_with_a_warning() {
        let directory = tempfile::tempdir().unwrap();
        let keybindings = read_pi_keybindings(directory.path());
        assert_eq!(keybindings.warnings.len(), 1);
        assert_eq!(find(&keybindings, "app.exit").keys, ["ctrl+d"]);
    }
}
