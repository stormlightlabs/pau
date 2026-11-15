#[cfg(target_os = "macos")]
mod login_path;
mod menu;
mod startup;
mod window_state;

use pau_core::startup::StartupProgress;
use pau_server::ServerOptions;
use startup::{PAGE_TIMEOUT, PROGRESS_EVENT, PauLauncher, StartupState};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// The label of the only window, which receives startup progress.
const MAIN_WINDOW: &str = "main";
/// The preferred first-launch size in logical pixels, wide enough for the
/// product rail, context rail, session, and inspector side by side.
const WINDOW_SIZE: (f64, f64) = (1440.0, 900.0);
/// The smallest size the window may take, and the narrowest the shared UI
/// is laid out and tested for. It keeps the context rail beside the session.
const WINDOW_MIN_SIZE: (f64, f64) = (900.0, 560.0);
/// The share of the screen's work area a first-launch window may cover.
const WINDOW_SCREEN_SHARE: f64 = 0.9;

/// Returns [`WINDOW_SIZE`] scaled down to fit the primary screen's work area,
/// but never below [`WINDOW_MIN_SIZE`].
///
/// The window opens at this size, centered, on first launch and whenever
/// [`window_state::restore`] leaves the saved state unused.
fn window_size(app: &tauri::App) -> (f64, f64) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return WINDOW_SIZE;
    };
    let area = monitor
        .work_area()
        .size
        .to_logical::<f64>(monitor.scale_factor());
    let fit = |preferred: f64, available: f64, min: f64| {
        preferred.min(available * WINDOW_SCREEN_SHARE).max(min)
    };
    (
        fit(WINDOW_SIZE.0, area.width, WINDOW_MIN_SIZE.0),
        fit(WINDOW_SIZE.1, area.height, WINDOW_MIN_SIZE.1),
    )
}

/// Returns the current startup snapshot, including the backend connection once
/// it is ready.
///
/// The page calls this after it subscribes to [`PROGRESS_EVENT`], so the call
/// also tells the shell that the page will show a later startup failure
/// itself instead of needing the native dialog.
#[tauri::command]
fn startup_progress(state: State<'_, StartupState>) -> StartupProgress {
    state.attach_page();
    state.snapshot()
}

/// Shows a startup failure in a native dialog and exits when it closes.
///
/// Setup runs on the main thread, and a blocking dialog would stall the event
/// loop that draws it, so the dialog exits from its callback.
fn show_failure_dialog(app: &AppHandle, reason: String) {
    let handle = app.clone();
    app.dialog()
        .message(reason)
        .title("Pau could not start")
        .kind(MessageDialogKind::Error)
        .show(move |_| handle.exit(1));
}

/// Runs the startup steps after the window opens, starting with the login
/// shell `PATH`, so a slow shell profile delays only the steps that need it.
///
/// When a required step fails and no page has attached within
/// [`PAGE_TIMEOUT`], the window probably cannot show the failure, so the
/// native dialog reports it instead.
async fn run_startup(app: AppHandle) {
    let state = app.state::<StartupState>();
    let launcher = app.state::<PauLauncher>();
    let result = startup::run(launcher.inner(), state.inner(), |progress| {
        if let Err(error) = app.emit_to(MAIN_WINDOW, PROGRESS_EVENT, progress) {
            tracing::warn!(%error, "could not send startup progress to the window");
        }
    })
    .await;
    let Err(reason) = result else { return };
    tracing::error!(%reason, "Pau could not start");
    if !state.wait_for_page(PAGE_TIMEOUT).await {
        show_failure_dialog(&app, reason);
    }
}

fn main() {
    // A sandboxed terminal starts this executable as its relay.
    pau_term::relay::run_if_requested();
    tracing_subscriber::fmt().json().init();
    let diagnostics = std::env::args().any(|argument| argument == "--diagnostics");

    let application = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // Links open through the shared UI handler, which checks the scheme.
        // The plugin's own click script would open `tel:` links and any
        // `target="_blank"` anchor outside that check.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_state::FLAGS)
                .skip_initial_state(MAIN_WINDOW)
                .build(),
        )
        .manage(StartupState::new())
        .invoke_handler(tauri::generate_handler![startup_progress])
        .menu(menu::build)
        .on_menu_event(menu::handle_event)
        .setup(move |app| {
            // A release build loads the sandbox extension from the app's
            // resources, the only copy left once the app is installed.
            app.manage(PauLauncher::new(
                None,
                ServerOptions {
                    diagnostics,
                    terminal_relay: std::env::current_exe().ok(),
                    resource_directory: app.path().resource_dir().ok(),
                    ..ServerOptions::default()
                },
            ));
            let (width, height) = window_size(app);
            let window = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::default())
                .title("Pau")
                .inner_size(width, height)
                .min_inner_size(WINDOW_MIN_SIZE.0, WINDOW_MIN_SIZE.1)
                .center()
                .visible(false)
                // Tauri's own handler consumes file drags before the page sees
                // them. The composer attaches dropped images through HTML5 drag
                // and drop, so the page must receive the events.
                .disable_drag_drop_handler()
                .build();
            match window {
                Ok(window) => {
                    window_state::restore(&window);
                    if let Err(error) = window.show().and_then(|()| window.set_focus()) {
                        tracing::error!(%error, "Pau could not show its window");
                    }
                    tauri::async_runtime::spawn(run_startup(app.handle().clone()));
                }
                Err(error) => {
                    tracing::error!(%error, "Pau could not open its window");
                    show_failure_dialog(app.handle(), startup::sentence(&error));
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the Pau desktop application");

    application.run(|app, event| {
        // Setup manages the launcher, so it is absent only when setup never ran.
        if let (RunEvent::Exit, Some(launcher)) = (event, app.try_state::<PauLauncher>()) {
            tauri::async_runtime::block_on(launcher.shutdown());
        }
    });
}
