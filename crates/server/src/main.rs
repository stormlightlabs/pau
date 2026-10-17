use std::{env, io, net::SocketAddr};

use pau_server::{ApiToken, ServerOptions};
use tracing_subscriber::EnvFilter;

const DEFAULT_ADDRESS: &str = "127.0.0.1:3001";

#[tokio::main]
async fn main() -> io::Result<()> {
    // Development settings live in the repository's .env file. Variables
    // already set in the environment win.
    if let Err(error) = dotenvy::dotenv()
        && !error.not_found()
    {
        return Err(io::Error::other(format!("could not read .env: {error}")));
    }
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .json()
        .init();

    let diagnostics = parse_diagnostics_flag(env::args().skip(1))?;
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
    let server = pau_server::start_with_token_and_options(
        address,
        ApiToken::configured(token)?,
        ServerOptions { diagnostics },
    )
    .await?;
    tokio::signal::ctrl_c().await?;
    server.shutdown().await
}

fn parse_diagnostics_flag(arguments: impl Iterator<Item = String>) -> io::Result<bool> {
    let mut diagnostics = false;
    for argument in arguments {
        if argument == "--diagnostics" {
            diagnostics = true;
        } else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("unknown option {argument:?}"),
            ));
        }
    }
    Ok(diagnostics)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_release_diagnostics_flag() {
        assert!(parse_diagnostics_flag(["--diagnostics".to_owned()].into_iter()).unwrap());
        assert!(!parse_diagnostics_flag([].into_iter()).unwrap());
        assert_eq!(
            parse_diagnostics_flag(["--inject-fault".to_owned()].into_iter())
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidInput
        );
    }
}
