use std::{env, io, net::SocketAddr};

use pau_server::ApiToken;
use tracing_subscriber::EnvFilter;

const DEFAULT_ADDRESS: &str = "127.0.0.1:3001";

#[tokio::main]
async fn main() -> io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .json()
        .init();

    let address = env::var("PAU_SERVER_ADDR").unwrap_or_else(|_| DEFAULT_ADDRESS.to_owned());
    let address: SocketAddr = address.parse().map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid PAU_SERVER_ADDR {address:?}: {error}"),
        )
    })?;
    let token = env::var("PAU_API_TOKEN").map_err(|_| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "PAU_API_TOKEN is required for the browser development server",
        )
    })?;
    let server = pau_server::start_with_token(address, ApiToken::configured(token)?).await?;
    tokio::signal::ctrl_c().await?;
    server.shutdown().await
}
