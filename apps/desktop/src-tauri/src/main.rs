mod menu;

use std::{error::Error, net::Ipv4Addr, sync::Mutex};

use pau_server::{ServerHandle, ServerOptions};
use tauri::{App, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// Owns the backend for exactly as long as the desktop application runs.
struct DesktopBackend(Mutex<ServerHandle>);

impl DesktopBackend {
    fn stop(&self) {
        if let Ok(mut server) = self.0.lock() {
            server.request_shutdown();
        }
    }
}

/// Starts the backend and opens the main window.
///
/// An error leaves the app without a window, so the caller must show it to the
/// user instead of letting the process exit silently.
fn start(app: &mut App, diagnostics: bool) -> Result<(), Box<dyn Error>> {
    let server = tauri::async_runtime::block_on(pau_server::start_with_options(
        (Ipv4Addr::LOCALHOST, 0).into(),
        ServerOptions { diagnostics },
    ))?;
    let script = connection_script(server.local_addr().port(), server.token().expose());

    WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .initialization_script(script)
        .title("Pau")
        .build()?;
    app.manage(DesktopBackend(Mutex::new(server)));
    Ok(())
}

/// Builds the script that hands the backend connection to the frontend.
///
/// The webview runs it before any page script on every load of the main frame,
/// so the API client finds `window.__PAU_DESKTOP__` after reloads and
/// navigation without the token appearing in the URL or history. The property
/// is read-only and its value is frozen, so later page code cannot point the
/// client at another origin. `serde_json` escapes both values as JavaScript
/// literals.
fn connection_script(port: u16, token: &str) -> String {
    let connection = serde_json::json!({
        "apiOrigin": format!("http://127.0.0.1:{port}"),
        "token": token,
    });
    format!(
        "Object.defineProperty(window, '__PAU_DESKTOP__', {{ value: Object.freeze({connection}) }});"
    )
}

/// Turns a startup error into dialog text that starts with a capital letter.
///
/// Backend errors begin in lowercase so they read well inside logs and wrapped
/// errors. The dialog shows the message on its own.
fn startup_failure_message(error: &dyn Error) -> String {
    let text = error.to_string();
    let mut characters = text.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => "Pau stopped during startup without reporting a reason.".to_owned(),
    }
}

fn main() {
    tracing_subscriber::fmt().json().init();
    let diagnostics = std::env::args().any(|argument| argument == "--diagnostics");

    let application = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .menu(menu::build)
        .on_menu_event(menu::handle_event)
        .setup(move |app| {
            if let Err(error) = start(app, diagnostics) {
                tracing::error!(%error, "Pau could not start");
                // Setup runs on the main thread. A blocking dialog would stall
                // the event loop that draws it, so exit from the callback.
                let handle = app.handle().clone();
                app.dialog()
                    .message(startup_failure_message(error.as_ref()))
                    .title("Pau could not start")
                    .kind(MessageDialogKind::Error)
                    .show(move |_| handle.exit(1));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the Pau desktop application");

    application.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit)
            && let Some(backend) = app.try_state::<DesktopBackend>()
        {
            backend.stop();
        }
    });
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::{connection_script, startup_failure_message};

    #[test]
    fn connection_script_defines_a_frozen_loopback_connection() {
        assert_eq!(
            connection_script(43127, "token-\"quoted\""),
            "Object.defineProperty(window, '__PAU_DESKTOP__', { value: Object.freeze(\
             {\"apiOrigin\":\"http://127.0.0.1:43127\",\"token\":\"token-\\\"quoted\\\"\"}) });"
        );
    }

    #[test]
    fn startup_failure_message_capitalizes_the_backend_error() {
        let error = io::Error::other("the Pau database uses schema version 9");

        assert_eq!(
            startup_failure_message(&error),
            "The Pau database uses schema version 9"
        );
    }

    #[test]
    fn startup_failure_message_explains_an_empty_error() {
        assert_eq!(
            startup_failure_message(&io::Error::other("")),
            "Pau stopped during startup without reporting a reason."
        );
    }
}
