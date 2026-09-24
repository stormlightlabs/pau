use std::{fmt, io, net::SocketAddr};

use axum::{
    Json, Router,
    extract::{Request, State, WebSocketUpgrade, ws::WebSocket},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::Response,
    routing::get,
};
use pau_core::{HealthResponse, VersionResponse};
use subtle::ConstantTimeEq;
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};
use tower_http::cors::CorsLayer;
use tracing::instrument::WithSubscriber;

/// Version returned by every Pau backend implementation.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

const TOKEN_BYTES: usize = 32;
const MIN_CONFIGURED_TOKEN_BYTES: usize = 32;

/// Bearer token that grants access to one local server launch.
///
/// Debug and display formatting are redacted so structured diagnostics cannot
/// expose a token by formatting it.
#[derive(Clone)]
pub struct ApiToken(String);

impl ApiToken {
    /// Generates an unguessable token from the operating system random source.
    pub fn generate() -> io::Result<Self> {
        let mut bytes = [0_u8; TOKEN_BYTES];
        getrandom::fill(&mut bytes).map_err(io::Error::other)?;
        let mut token = String::with_capacity(TOKEN_BYTES * 2);
        for byte in bytes {
            use fmt::Write as _;
            write!(token, "{byte:02x}").expect("writing to a string cannot fail");
        }
        Ok(Self(token))
    }

    /// Uses a configured token after enforcing the minimum local-token length.
    pub fn configured(value: impl Into<String>) -> io::Result<Self> {
        let value = value.into();
        if value.len() < MIN_CONFIGURED_TOKEN_BYTES
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "PAU_API_TOKEN must contain at least 32 URL-safe ASCII characters",
            ));
        }
        Ok(Self(value))
    }

    /// Exposes the token for delivery to an authenticated client.
    pub fn expose(&self) -> &str {
        &self.0
    }

    fn matches(&self, candidate: &str) -> bool {
        candidate.len() == self.0.len() && bool::from(candidate.as_bytes().ct_eq(self.0.as_bytes()))
    }
}

impl fmt::Debug for ApiToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ApiToken([REDACTED])")
    }
}

impl fmt::Display for ApiToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("[REDACTED]")
    }
}

/// Builds the authenticated API used by desktop and browser clients.
pub fn router(token: ApiToken) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/version", get(version))
        .route("/api/events", get(websocket))
        .layer(middleware::from_fn_with_state(token, authenticate))
        .layer(CorsLayer::permissive())
}

async fn authenticate(
    State(token): State<ApiToken>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let bearer = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let websocket_token = (request.uri().path() == "/api/events")
        .then(|| request.headers().get(header::SEC_WEBSOCKET_PROTOCOL))
        .flatten()
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .map(str::trim)
                .find_map(|protocol| protocol.strip_prefix("pau.bearer."))
        });
    let authenticated = bearer
        .into_iter()
        .chain(websocket_token)
        .any(|candidate| token.matches(candidate));

    if !authenticated {
        let transport = if request.uri().path() == "/api/events" {
            "websocket"
        } else {
            "http"
        };
        tracing::warn!(
            event = "api.authentication_failed",
            transport,
            "local API authentication failed"
        );
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(next.run(request).await)
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { healthy: true })
}

async fn version() -> Json<VersionResponse> {
    Json(VersionResponse {
        version: VERSION.to_owned(),
    })
}

async fn websocket(upgrade: WebSocketUpgrade) -> Response {
    upgrade.protocols(["pau"]).on_upgrade(hold_websocket)
}

async fn hold_websocket(mut socket: WebSocket) {
    while socket.recv().await.is_some() {}
}

/// A running local server and its graceful-shutdown signal.
#[derive(Debug)]
pub struct ServerHandle {
    address: SocketAddr,
    token: ApiToken,
    shutdown: Option<oneshot::Sender<()>>,
    task: Option<JoinHandle<io::Result<()>>>,
}

impl ServerHandle {
    /// Returns the loopback address selected by the operating system.
    pub fn local_addr(&self) -> SocketAddr {
        self.address
    }

    /// Returns the bearer token generated for this server launch.
    pub fn token(&self) -> &ApiToken {
        &self.token
    }

    /// Starts graceful shutdown without waiting for the listener task.
    pub fn request_shutdown(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
    }

    /// Stops the server and waits for its listener task.
    pub async fn shutdown(mut self) -> io::Result<()> {
        self.request_shutdown();
        self.task
            .take()
            .expect("server task is present until shutdown")
            .await
            .map_err(io::Error::other)?
    }
}

impl Drop for ServerHandle {
    fn drop(&mut self) {
        self.request_shutdown();
    }
}

/// Starts the shared API with a new per-launch token.
///
/// Pass port `0` to let the operating system choose an unused port.
pub async fn start(address: SocketAddr) -> io::Result<ServerHandle> {
    start_with_token(address, ApiToken::generate()?).await
}

/// Starts the shared API with an explicitly configured token.
///
/// This entry point supports browser development, where Vite and the server
/// receive the same token through their process environments.
pub async fn start_with_token(address: SocketAddr, token: ApiToken) -> io::Result<ServerHandle> {
    if !address.ip().is_loopback() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the local Pau server must bind to a loopback address",
        ));
    }

    let listener = TcpListener::bind(address).await?;
    let address = listener.local_addr()?;
    let (shutdown, shutdown_receiver) = oneshot::channel();
    let server_token = token.clone();
    let dispatch = tracing::dispatcher::get_default(Clone::clone);
    let task = tokio::spawn(
        async move {
            axum::serve(listener, router(server_token))
                .with_graceful_shutdown(async move {
                    let _ = shutdown_receiver.await;
                })
                .await
        }
        .with_subscriber(dispatch),
    );

    tracing::info!(
        event = "server.started",
        address = %address,
        "local API server started"
    );

    Ok(ServerHandle {
        address,
        token,
        shutdown: Some(shutdown),
        task: Some(task),
    })
}

#[cfg(test)]
mod tests {
    use std::{
        net::Ipv4Addr,
        sync::{Arc, Mutex},
        time::Duration,
    };

    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
        time::timeout,
    };
    use tower::ServiceExt;
    use tracing_subscriber::fmt::MakeWriter;

    use super::*;

    const TEST_TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[derive(Clone, Default)]
    struct LogBuffer(Arc<Mutex<Vec<u8>>>);

    struct LogWriter(Arc<Mutex<Vec<u8>>>);

    impl io::Write for LogWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl<'a> MakeWriter<'a> for LogBuffer {
        type Writer = LogWriter;

        fn make_writer(&'a self) -> Self::Writer {
            LogWriter(Arc::clone(&self.0))
        }
    }

    impl LogBuffer {
        fn contents(&self) -> String {
            String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
        }
    }

    fn test_token() -> ApiToken {
        ApiToken::configured(TEST_TOKEN).unwrap()
    }

    async fn response(address: SocketAddr, request: &str, read_to_end: bool) -> String {
        let mut stream = TcpStream::connect(address).await.unwrap();
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut bytes = Vec::new();
        if read_to_end {
            stream.read_to_end(&mut bytes).await.unwrap();
        } else {
            loop {
                let mut chunk = [0_u8; 512];
                let count = timeout(Duration::from_secs(1), stream.read(&mut chunk))
                    .await
                    .unwrap()
                    .unwrap();
                bytes.extend_from_slice(&chunk[..count]);
                if count == 0 || bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
        }
        String::from_utf8(bytes).unwrap()
    }

    fn get(path: &str, authorization: Option<&str>) -> String {
        let authorization = authorization
            .map(|value| format!("Authorization: Bearer {value}\r\n"))
            .unwrap_or_default();
        format!(
            "GET {path} HTTP/1.1\r\nHost: localhost\r\n{authorization}Connection: close\r\n\r\n"
        )
    }

    fn websocket_request(token: Option<&str>) -> String {
        let protocols = token
            .map(|value| format!("Sec-WebSocket-Protocol: pau, pau.bearer.{value}\r\n"))
            .unwrap_or_default();
        format!(
            "GET /api/events HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n{protocols}\r\n"
        )
    }

    #[tokio::test]
    async fn protects_health_and_version_endpoints() {
        let server = start_with_token((Ipv4Addr::LOCALHOST, 0).into(), test_token())
            .await
            .unwrap();

        for path in ["/api/health", "/api/version"] {
            let missing = response(server.local_addr(), &get(path, None), true).await;
            assert!(missing.starts_with("HTTP/1.1 401 Unauthorized"));

            let invalid = response(server.local_addr(), &get(path, Some("invalid")), true).await;
            assert!(invalid.starts_with("HTTP/1.1 401 Unauthorized"));
        }

        let health = response(
            server.local_addr(),
            &get("/api/health", Some(TEST_TOKEN)),
            true,
        )
        .await;
        assert!(health.starts_with("HTTP/1.1 200 OK"));
        assert!(health.ends_with("{\"healthy\":true}"));

        let version = response(
            server.local_addr(),
            &get("/api/version", Some(TEST_TOKEN)),
            true,
        )
        .await;
        assert!(version.starts_with("HTTP/1.1 200 OK"));
        assert!(version.ends_with(&format!("{{\"version\":\"{VERSION}\"}}")));

        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn protects_websocket_handshakes() {
        let server = start_with_token((Ipv4Addr::LOCALHOST, 0).into(), test_token())
            .await
            .unwrap();

        for authorization in [None, Some("invalid")] {
            let handshake = response(
                server.local_addr(),
                &websocket_request(authorization),
                false,
            )
            .await;
            assert!(handshake.starts_with("HTTP/1.1 401 Unauthorized"));
        }

        let handshake = response(
            server.local_addr(),
            &websocket_request(Some(TEST_TOKEN)),
            false,
        )
        .await;
        assert!(handshake.starts_with("HTTP/1.1 101 Switching Protocols"));
        assert!(
            handshake
                .to_ascii_lowercase()
                .contains("sec-websocket-protocol: pau")
        );

        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn diagnostics_do_not_contain_tokens_or_supplied_secrets() {
        let logs = LogBuffer::default();
        let subscriber = tracing_subscriber::fmt()
            .json()
            .with_ansi(false)
            .with_writer(logs.clone())
            .finish();
        let configured_secret = "configured-secret-that-must-not-appear";

        async {
            let request = Request::builder()
                .uri("/api/version")
                .header(header::AUTHORIZATION, format!("Bearer {configured_secret}"))
                .body(axum::body::Body::empty())
                .unwrap();
            let response = router(test_token()).oneshot(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
        .with_subscriber(subscriber)
        .await;

        let logs = logs.contents();
        assert!(logs.contains("api.authentication_failed"));
        assert!(!logs.contains(TEST_TOKEN));
        assert!(!logs.contains(configured_secret));
        assert_eq!(format!("{:?}", test_token()), "ApiToken([REDACTED])");
    }

    #[tokio::test]
    async fn shutdown_closes_the_listener() {
        let server = start((Ipv4Addr::LOCALHOST, 0).into()).await.unwrap();
        let address = server.local_addr();

        server.shutdown().await.unwrap();

        assert!(
            timeout(Duration::from_secs(1), TcpStream::connect(address))
                .await
                .unwrap()
                .is_err()
        );
    }

    #[tokio::test]
    async fn rejects_non_loopback_addresses() {
        let error = start((Ipv4Addr::UNSPECIFIED, 0).into()).await.unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn rejects_short_configured_tokens() {
        assert_eq!(
            ApiToken::configured("too-short").unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
    }
}
