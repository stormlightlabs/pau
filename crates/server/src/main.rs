use std::{env, io, net::SocketAddr};

use pau_server::{ApiToken, ServerOptions};
use tracing_subscriber::EnvFilter;

const DEFAULT_ADDRESS: &str = "127.0.0.1:3001";

fn main() -> io::Result<()> {
    // Development settings live in the repository's .env file. Variables
    // already set in the environment win.
    if let Err(error) = dotenvy::dotenv()
        && !error.not_found()
    {
        return Err(io::Error::other(format!("could not read .env: {error}")));
    }
    // The environment changes only here, before the runtime starts any thread.
    let token = take_api_token()?;
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(serve(token))
}

/// Reads the API token and removes it from the process environment.
///
/// Every child process inherits the server's environment: agents, the
/// commands they run, MCP servers, terminals and discovery probes. Any of them
/// could call the API with the token, so it lives only in memory.
///
/// Call it while the process has one thread: removing a variable races with
/// any concurrent read of the environment.
fn take_api_token() -> io::Result<String> {
    let token = env::var("PAU_API_TOKEN").map_err(|_| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "PAU_API_TOKEN is required for the browser development server",
        )
    })?;
    // SAFETY: callers run before any other thread exists.
    unsafe { env::remove_var("PAU_API_TOKEN") };
    Ok(token)
}

async fn serve(token: String) -> io::Result<()> {
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

    #[test]
    fn child_processes_do_not_inherit_the_api_token() {
        let token = "a".repeat(32);
        // SAFETY: no other test in this binary reads or writes the
        // environment.
        unsafe { env::set_var("PAU_API_TOKEN", &token) };

        assert_eq!(take_api_token().unwrap(), token);
        let child = std::process::Command::new("sh")
            .args(["-c", "printf %s \"${PAU_API_TOKEN-unset}\""])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&child.stdout), "unset");
        assert_eq!(
            take_api_token().unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
    }
}
