//! Development-only PTY and WebSocket prototype.
//!
//! Run this example, then open the live terminal prototype story in Storybook.

use std::{
    env,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};

use axum::{
    Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
    routing::get,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Deserialize;
use tokio::{net::TcpListener, sync::broadcast};

const DEFAULT_ADDRESS: &str = "127.0.0.1:3908";

struct TerminalState {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    output: broadcast::Sender<Vec<u8>>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ControlMessage {
    Resize { cols: u16, rows: u16 },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    let state = Arc::new(start_shell()?);
    let app = Router::new()
        .route("/terminal", get(upgrade_terminal))
        .with_state(Arc::clone(&state));
    let address =
        env::var("PAU_TERMINAL_PROTOTYPE_ADDRESS").unwrap_or_else(|_| DEFAULT_ADDRESS.into());
    let listener = TcpListener::bind(&address).await?;

    println!("terminal prototype listening on ws://{address}/terminal");
    println!(
        "open Storybook's Prototypes/Terminal live story, then try nvim, resize, Unicode input, and reconnect"
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    state.child.lock().expect("child lock poisoned").kill()?;
    Ok(())
}

fn start_shell() -> Result<TerminalState, Box<dyn std::error::Error>> {
    let pair = NativePtySystem::default().openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    })?;
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let mut command = CommandBuilder::new(shell);
    command.arg("-i");
    command.env("TERM", "xterm-256color");
    command.cwd(env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let child = pair.slave.spawn_command(command)?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;
    let (output, _) = broadcast::channel(128);
    let reader_output = output.clone();

    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 {
                break;
            }
            let _ = reader_output.send(buffer[..count].to_vec());
        }
    });

    Ok(TerminalState {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
        output,
    })
}

async fn upgrade_terminal(
    State(state): State<Arc<TerminalState>>,
    upgrade: WebSocketUpgrade,
) -> Response {
    upgrade.on_upgrade(move |socket| serve_terminal(socket, state))
}

async fn serve_terminal(socket: WebSocket, state: Arc<TerminalState>) {
    let (mut sender, mut receiver) = socket.split();
    let mut output = state.output.subscribe();

    loop {
        tokio::select! {
            message = receiver.next() => match message {
                Some(Ok(Message::Binary(bytes))) => {
                    if state.writer.lock().expect("writer lock poisoned").write_all(&bytes).is_err() {
                        break;
                    }
                }
                Some(Ok(Message::Text(text))) => {
                    let Ok(ControlMessage::Resize { cols, rows }) = serde_json::from_str(&text) else {
                        continue;
                    };
                    let size = PtySize { rows, cols, pixel_width: 0, pixel_height: 0 };
                    if state.master.lock().expect("master lock poisoned").resize(size).is_err() {
                        break;
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                _ => {}
            },
            bytes = output.recv() => match bytes {
                Ok(bytes) => {
                    if sender.send(Message::Binary(bytes.into())).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }
}
