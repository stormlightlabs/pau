use std::{env, net::SocketAddr};

const DEFAULT_ADDRESS: &str = "127.0.0.1:3001";

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let address = env::var("PAU_SERVER_ADDR").unwrap_or_else(|_| DEFAULT_ADDRESS.to_owned());
    let address: SocketAddr = address.parse().map_err(|error| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("invalid PAU_SERVER_ADDR {address:?}: {error}"),
        )
    })?;
    let server = pau_server::start(address).await?;
    println!("Pau server listening on http://{}", server.local_addr());
    tokio::signal::ctrl_c().await?;
    server.shutdown().await
}
