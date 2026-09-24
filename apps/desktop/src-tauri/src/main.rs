use std::{net::Ipv4Addr, sync::Mutex};

use pau_server::ServerHandle;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// Owns the backend for exactly as long as the desktop application runs.
struct DesktopBackend(Mutex<ServerHandle>);

impl DesktopBackend {
    fn stop(&self) {
        if let Ok(mut server) = self.0.lock() {
            server.request_shutdown();
        }
    }
}

fn main() {
    tracing_subscriber::fmt().json().init();

    let application = tauri::Builder::default()
        .setup(|app| {
            let server =
                tauri::async_runtime::block_on(pau_server::start((Ipv4Addr::LOCALHOST, 0).into()))?;
            let frontend_url = format!(
                "index.html?pau-api-port={}&pau-api-token={}",
                server.local_addr().port(),
                server.token().expose()
            );

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App(frontend_url.into()))
                .title("Pau")
                .build()?;
            app.manage(DesktopBackend(Mutex::new(server)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the Pau desktop application");

    application.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            app.state::<DesktopBackend>().stop();
        }
    });
}
