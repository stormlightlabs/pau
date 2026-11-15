//! The browser development server.
//!
//! It takes its API token from the first source that has one:
//!
//! 1. Standard input, with `--token-stdin`.
//! 2. `PAU_API_TOKEN` in the `.env` file of the directory the server starts
//!    from. Parent directories are not searched, so a `.env` in the home
//!    directory cannot replace the token.
//! 3. `PAU_API_TOKEN` in the launch environment. Processes run by the same
//!    user can read that with `ps eww` or `/proc/<pid>/environ`, so the
//!    server prints a warning when it uses a token from there.
//!
//! The desktop app embeds the server with a token held in memory and does not
//! use this binary.

use std::{
    env,
    ffi::OsString,
    fs,
    io::{self, BufRead},
    net::SocketAddr,
};

use pau_server::{ApiToken, ServerOptions};
use tracing_subscriber::EnvFilter;

const DEFAULT_ADDRESS: &str = "127.0.0.1:3001";

const TOKEN_VARIABLE: &str = "PAU_API_TOKEN";

const ENV_FILE: &str = ".env";

/// Command-line options of the browser development server.
#[derive(Debug, Default, PartialEq)]
struct Options {
    /// Serve the release diagnostics routes.
    diagnostics: bool,
    /// Read the API token from the first line of standard input.
    token_stdin: bool,
}

fn main() -> io::Result<()> {
    pau_term::relay::run_if_requested();
    let options = parse_options(env::args().skip(1))?;
    // The environment changes only here, before the runtime starts any thread.
    // Taking the exported token first leaves the variable unset, so `.env`
    // can set it and its value wins over the exported one.
    let exported = take_api_token();
    load_env_file()?;
    let from_env_file = take_api_token();
    let token = if options.token_stdin {
        read_token(io::stdin().lock())?
    } else if let Some(token) = from_env_file {
        if exported.is_some() {
            eprintln!("note: using PAU_API_TOKEN from .env instead of the exported one.");
        }
        token_string(token)?
    } else if let Some(token) = exported {
        let token = token_string(token)?;
        eprintln!(
            "warning: PAU_API_TOKEN came from the environment, where agents and commands the server starts can read it. Put it in .env or pass it with --token-stdin to avoid that."
        );
        token
    } else {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "the browser development server needs a token on standard input with --token-stdin, or PAU_API_TOKEN in .env or the environment",
        ));
    };
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(serve(token, options.diagnostics))
}

/// Loads development settings from `.env` in the working directory, without
/// replacing variables that are already set. A missing file is not an error.
///
/// Only the working directory counts: searching its parents, as
/// `dotenvy::dotenv` does, would let a stray `.env` higher up supply the token.
fn load_env_file() -> io::Result<()> {
    let text = match fs::read_to_string(ENV_FILE) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io::Error::other(format!("could not read .env: {error}"))),
    };
    dotenvy::from_read(text.as_bytes())
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, env_file_error(&text, &error)))
}

/// Describes a `.env` error without the content of the line, which may hold
/// the token. A parse error names the line number and, when the line starts
/// with one, the variable name.
///
/// dotenvy reports the text it failed on, which is the whole line or only its
/// value, so the line is found by searching the file for that text.
fn env_file_error(text: &str, error: &dotenvy::Error) -> String {
    let dotenvy::Error::LineParse(failed, _) = error else {
        return format!("could not read .env: {error}");
    };
    let Some(offset) = text.find(failed.as_str()) else {
        return String::from("could not parse .env");
    };
    let start = text[..offset].rfind('\n').map_or(0, |index| index + 1);
    let number = text[..start].matches('\n').count() + 1;
    let line = text[start..].lines().next().unwrap_or_default();
    let name = line.split_once('=').map(|(key, _)| {
        let key = key.trim();
        key.strip_prefix("export ").unwrap_or(key).trim()
    });
    match name.filter(|name| {
        !name.is_empty()
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
    }) {
        Some(name) => format!("could not parse .env at line {number} ({name})"),
        None => format!("could not parse .env at line {number}"),
    }
}

/// Removes the token from the environment and returns it, unless it is empty
/// or only whitespace, which counts as unset.
///
/// Every child process inherits the server's environment: agents, the
/// commands they run, MCP servers, terminals and discovery probes. Removing
/// the variable keeps the token out of theirs, whatever its encoding. It does
/// not clear the launch environment that same-user processes can read, which
/// still holds a token exported before the server started.
///
/// Call it while the process has one thread: removing a variable races with
/// any concurrent read of the environment.
fn take_api_token() -> Option<OsString> {
    let token = env::var_os(TOKEN_VARIABLE)?;
    // SAFETY: callers run before any other thread exists.
    unsafe { env::remove_var(TOKEN_VARIABLE) };
    (!token.to_string_lossy().trim().is_empty()).then_some(token)
}

/// Converts a token taken from the environment, which may not be UTF-8.
fn token_string(token: OsString) -> io::Result<String> {
    token.into_string().map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "PAU_API_TOKEN is not valid UTF-8",
        )
    })
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
        ServerOptions {
            diagnostics,
            terminal_relay: env::current_exe().ok(),
            ..ServerOptions::default()
        },
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

    /// The first error parsing `text` gives, read without setting variables.
    fn parse_error(text: &str) -> String {
        let error = dotenvy::from_read_iter(text.as_bytes())
            .find_map(Result::err)
            .unwrap();
        env_file_error(text, &error)
    }

    #[test]
    fn env_file_errors_leave_out_the_line() {
        let text = "# settings\n\nPAU_SERVER_ADDR=127.0.0.1:3001\nPAU_API_TOKEN=secret value\n";
        assert_eq!(
            parse_error(text),
            "could not parse .env at line 4 (PAU_API_TOKEN)"
        );
        assert_eq!(
            parse_error("secret value\n"),
            "could not parse .env at line 1"
        );
    }

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
        let child_sees = || {
            let child = std::process::Command::new("sh")
                .args(["-c", "printf %s \"${PAU_API_TOKEN-unset}\""])
                .output()
                .unwrap();
            String::from_utf8_lossy(&child.stdout).into_owned()
        };
        // SAFETY: no other test in this binary reads or writes the
        // environment.
        unsafe { env::set_var(TOKEN_VARIABLE, &token) };
        assert_eq!(take_api_token(), Some(token.into()));
        assert_eq!(child_sees(), "unset");
        assert_eq!(take_api_token(), None);

        // A blank value counts as unset but is still removed.
        unsafe { env::set_var(TOKEN_VARIABLE, " ") };
        assert_eq!(take_api_token(), None);
        assert_eq!(child_sees(), "unset");

        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            let invalid = std::ffi::OsStr::from_bytes(b"\xff\xfe");
            unsafe { env::set_var(TOKEN_VARIABLE, invalid) };
            let taken = take_api_token().unwrap();
            assert_eq!(child_sees(), "unset");
            assert_eq!(
                token_string(taken).unwrap_err().kind(),
                io::ErrorKind::InvalidData
            );
        }
    }
}
