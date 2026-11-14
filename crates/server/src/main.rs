use std::{
    env,
    io::{self, BufRead},
    net::SocketAddr,
};

use pau_server::{ApiToken, ServerOptions};
use tracing_subscriber::EnvFilter;

const DEFAULT_ADDRESS: &str = "127.0.0.1:3001";

const TOKEN_VARIABLE: &str = "PAU_API_TOKEN";

/// Command-line options of the browser development server.
#[derive(Debug, Default, PartialEq)]
struct Options {
    /// Serve the release diagnostics routes.
    diagnostics: bool,
    /// Read the API token from the first line of standard input.
    token_stdin: bool,
}

fn main() -> io::Result<()> {
    let options = parse_options(env::args().skip(1))?;
    // Same-user processes can read a process's launch environment, so a token
    // there is exposed however soon the server drops it.
    if env::var_os(TOKEN_VARIABLE).is_some() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "PAU_API_TOKEN must not be set in the environment, where other processes can read it; put it in .env or pass it with --token-stdin",
        ));
    }
    // Development settings live in the repository's .env file. Variables
    // already set in the environment win.
    if let Err(error) = dotenvy::dotenv()
        && !error.not_found()
    {
        return Err(io::Error::other(format!("could not read .env: {error}")));
    }
    // The environment changes only here, before the runtime starts any thread.
    let from_file = take_api_token();
    let token = if options.token_stdin {
        read_token(io::stdin().lock())?
    } else {
        from_file.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "the browser development server needs PAU_API_TOKEN in .env or a token on standard input with --token-stdin",
            )
        })?
    };
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(serve(token, options.diagnostics))
}

/// Removes the token that `.env` loaded and returns it.
///
/// Every child process inherits the server's environment: agents, the
/// commands they run, MCP servers, terminals and discovery probes. Removing
/// the variable keeps the token out of theirs. The launch environment, which
/// same-user processes can read, never held it, because `main` refuses a
/// token set there.
///
/// Call it while the process has one thread: removing a variable races with
/// any concurrent read of the environment.
fn take_api_token() -> Option<String> {
    let token = env::var(TOKEN_VARIABLE).ok()?;
    // SAFETY: callers run before any other thread exists.
    unsafe { env::remove_var(TOKEN_VARIABLE) };
    Some(token)
}

/// Reads the token from the first line of `input`, without its line ending.
fn read_token(mut input: impl BufRead) -> io::Result<String> {
    let mut line = String::new();
    input.read_line(&mut line)?;
    let token = line.trim_end_matches(['\r', '\n']);
    if token.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "--token-stdin read no token from standard input",
        ));
    }
    Ok(token.to_owned())
}

async fn serve(token: String, diagnostics: bool) -> io::Result<()> {
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
    let server = pau_server::start_with_token_and_options(
        address,
        ApiToken::configured(token)?,
        ServerOptions { diagnostics },
    )
    .await?;
    tokio::signal::ctrl_c().await?;
    server.shutdown().await
}

fn parse_options(arguments: impl Iterator<Item = String>) -> io::Result<Options> {
    let mut options = Options::default();
    for argument in arguments {
        match argument.as_str() {
            "--diagnostics" => options.diagnostics = true,
            "--token-stdin" => options.token_stdin = true,
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("unknown option {argument:?}"),
                ));
            }
        }
    }
    Ok(options)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_known_options() {
        let parse = |arguments: &[&str]| {
            parse_options(arguments.iter().map(|argument| (*argument).to_owned()))
        };
        assert_eq!(
            parse(&["--diagnostics", "--token-stdin"]).unwrap(),
            Options {
                diagnostics: true,
                token_stdin: true
            }
        );
        assert_eq!(parse(&[]).unwrap(), Options::default());
        assert_eq!(
            parse(&["--inject-fault"]).unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
    }

    #[test]
    fn reads_the_token_from_the_first_line() {
        let token = "a".repeat(32);
        assert_eq!(
            read_token(io::Cursor::new(format!("{token}\nrest"))).unwrap(),
            token
        );
        assert_eq!(
            read_token(io::Cursor::new(format!("{token}\r\n"))).unwrap(),
            token
        );
        assert_eq!(read_token(io::Cursor::new(token.clone())).unwrap(), token);
        assert_eq!(
            read_token(io::Cursor::new("\n")).unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
    }

    #[test]
    fn child_processes_do_not_inherit_the_api_token() {
        let token = "a".repeat(32);
        // SAFETY: no other test in this binary reads or writes the
        // environment.
        unsafe { env::set_var(TOKEN_VARIABLE, &token) };

        assert_eq!(take_api_token(), Some(token));
        let child = std::process::Command::new("sh")
            .args(["-c", "printf %s \"${PAU_API_TOKEN-unset}\""])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&child.stdout), "unset");
        assert_eq!(take_api_token(), None);
    }
}
