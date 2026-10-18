//! The native app menu.
//!
//! Pau's own menu items carry the ID of a frontend key map action. Choosing
//! one emits [`MENU_ACTION_EVENT`] with that ID, and the frontend runs the
//! same action its keyboard shortcut runs. The Edit menu uses the platform's
//! predefined items so copy, paste, undo, and redo keep working in text fields.

use tauri::{
    AppHandle, Emitter, Runtime,
    menu::{Menu, MenuEvent, MenuItem, Submenu, SubmenuBuilder},
};

/// The event that carries a chosen menu item's action ID to the frontend.
pub const MENU_ACTION_EVENT: &str = "pau://menu-action";

/// One Pau menu item: its action ID, its label, and its macOS accelerator.
struct ActionItem {
    action: &'static str,
    label: &'static str,
    accelerator: Option<&'static str>,
}

const NEW_SESSION: ActionItem = ActionItem {
    action: "session.new",
    label: "New Session",
    accelerator: Some("CmdOrCtrl+N"),
};
const OPEN_WORKSPACE: ActionItem = ActionItem {
    action: "workspace.open",
    label: "Open Workspace…",
    accelerator: Some("CmdOrCtrl+O"),
};
const ZOOM_IN: ActionItem = ActionItem {
    action: "view.zoomIn",
    label: "Zoom In",
    accelerator: Some("CmdOrCtrl+="),
};
const ZOOM_OUT: ActionItem = ActionItem {
    action: "view.zoomOut",
    label: "Zoom Out",
    accelerator: Some("CmdOrCtrl+-"),
};
const ACTUAL_SIZE: ActionItem = ActionItem {
    action: "view.zoomReset",
    label: "Actual Size",
    accelerator: Some("CmdOrCtrl+0"),
};
/// No accelerator: code editors use ⌘/ to toggle comments, and an
/// accelerator would take it before the page sees it. The page handles ⌘/.
const KEYBOARD_SHORTCUTS: ActionItem = ActionItem {
    action: "app.shortcuts",
    label: "Keyboard Shortcuts",
    accelerator: None,
};

const ACTION_ITEMS: [&ActionItem; 6] = [
    &NEW_SESSION,
    &OPEN_WORKSPACE,
    &ZOOM_IN,
    &ZOOM_OUT,
    &ACTUAL_SIZE,
    &KEYBOARD_SHORTCUTS,
];

/// Returns the frontend action for a menu item ID, or `None` for the
/// platform's predefined items.
pub fn menu_action(id: &str) -> Option<&'static str> {
    ACTION_ITEMS
        .iter()
        .find(|item| item.action == id)
        .map(|item| item.action)
}

/// Returns the accelerator a Pau menu item shows on this platform.
///
/// Only macOS gets accelerators. Elsewhere ⌘ means Ctrl, and Pi binds many
/// Ctrl chords, such as Ctrl+N and Ctrl+O. A menu accelerator would take
/// those keys before the page could give them to the operator's Pi
/// bindings, so the page's key map handles them instead.
fn accelerator(item: &ActionItem) -> Option<&'static str> {
    if cfg!(target_os = "macos") {
        item.accelerator
    } else {
        None
    }
}

fn action_item<R: Runtime>(app: &AppHandle<R>, item: &ActionItem) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, item.action, item.label, true, accelerator(item))
}

/// Builds the app menu: the platform's standard menus plus Pau's actions.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let file = SubmenuBuilder::new(app, "File")
        .item(&action_item(app, &NEW_SESSION)?)
        .item(&action_item(app, &OPEN_WORKSPACE)?)
        .separator()
        .close_window()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&action_item(app, &ZOOM_IN)?)
        .item(&action_item(app, &ZOOM_OUT)?)
        .item(&action_item(app, &ACTUAL_SIZE)?)
        .separator()
        .fullscreen()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&action_item(app, &KEYBOARD_SHORTCUTS)?)
        .build()?;

    let mut submenus: Vec<Submenu<R>> = Vec::new();
    if cfg!(target_os = "macos") {
        submenus.push(
            SubmenuBuilder::new(app, "Pau")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?,
        );
    }
    submenus.extend([file, edit, view, window, help]);
    let items: Vec<&dyn tauri::menu::IsMenuItem<R>> = submenus
        .iter()
        .map(|submenu| submenu as &dyn tauri::menu::IsMenuItem<R>)
        .collect();
    Menu::with_items(app, &items)
}

/// Sends a chosen Pau menu item to the frontend as a key map action.
pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if let Some(action) = menu_action(event.id().as_ref())
        && let Err(error) = app.emit(MENU_ACTION_EVENT, action)
    {
        tracing::warn!(%error, action, "Pau could not deliver a menu action");
    }
}

#[cfg(test)]
mod tests {
    use super::{ACTION_ITEMS, menu_action};

    #[test]
    fn menu_items_map_to_their_frontend_actions() {
        assert_eq!(menu_action("session.new"), Some("session.new"));
        assert_eq!(menu_action("workspace.open"), Some("workspace.open"));
        assert_eq!(menu_action("view.zoomReset"), Some("view.zoomReset"));
        assert_eq!(menu_action("copy"), None);
    }

    #[test]
    fn action_ids_are_unique() {
        for (index, item) in ACTION_ITEMS.iter().enumerate() {
            assert!(
                ACTION_ITEMS[index + 1..]
                    .iter()
                    .all(|other| other.action != item.action),
                "{} appears twice",
                item.action
            );
        }
    }
}
