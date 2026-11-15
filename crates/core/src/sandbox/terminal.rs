//! Sandboxed operator terminals.
//!
//! A sandboxed terminal starts sandbox-runtime's `srt` command on Pau's PTY
//! with the resolved runtime configuration as its settings file. The shell
//! therefore inherits the same filesystem, network, and environment policy as
//! a sandboxed session's tools.
//!
//! How the shell reaches a terminal depends on the platform:
//!
//! - Bubblewrap detaches the sandboxed command from Pau's PTY, so on Linux
//!   `srt` runs the `pau-term` relay, which runs the shell on a PTY of its own
//!   inside the sandbox.
//! - Seatbelt keeps the command on Pau's PTY, but opening a PTY inside it
//!   needs sandbox-runtime's `allowPty`, which opens every `/dev/ttys*`
//!   device. On macOS the shell instead runs on Pau's PTY, reopened as
//!   `/dev/tty`, and the profile denies every other terminal device.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use super::{
    EffectiveSandbox, SandboxAdapter, SandboxError, SandboxLaunchInput,
    executables::SandboxPlatform, prepare_sandbox, resolve_sandbox, write_private_file,
};

/// Inputs for one sandboxed terminal.
pub struct TerminalSandboxInput<'a> {
    /// Launch inputs. The adapter is always [`SandboxAdapter::Terminal`].
    pub launch: SandboxLaunchInput<'a>,
    /// Program and leading arguments that start the relay, such as the
    /// running executable and `--pau-term-relay`. The command follows them.
    /// Only Linux uses the relay.
    pub relay: &'a [String],
    /// Program and arguments to run in the sandbox, usually the shell.
    pub command: &'a [String],
    /// The operator's shell, given to the command as `SHELL`.
    pub shell: &'a str,
}

/// A prepared sandboxed terminal: the `srt` command to start on Pau's PTY.
#[derive(Debug, Clone, PartialEq)]
pub struct TerminalSandboxLaunch {
    /// Profile shown with the terminal.
    pub effective: EffectiveSandbox,
    /// Placeholders sandbox-runtime may create, to remove when the terminal
    /// ends.
    pub placeholders: Vec<PathBuf>,
    /// Absolute path of `srt`.
    pub program: String,
    /// Arguments for `srt`.
    pub args: Vec<String>,
    /// Complete environment for `srt`, which passes it to the relay and the
    /// shell. Nothing from Pau's environment is added.
    pub environment: Vec<(OsString, OsString)>,
    /// Whether `srt` runs the relay, so Pau's PTY carries relay frames.
    pub relay: bool,
}

/// Resolves the terminal profile, writes `srt`'s settings file, and returns
/// the command that starts the shell inside the sandbox.
///
/// Fails when `srt` is missing, so a terminal never starts unsandboxed in
/// place of the profile the operator chose.
pub fn prepare_terminal_sandbox(
    input: &TerminalSandboxInput<'_>,
) -> Result<TerminalSandboxLaunch, SandboxError> {
    let srt = input.launch.executables.srt()?;
    if input.command.is_empty() {
        return Err(SandboxError::Invalid(
            "the terminal command must name a program".into(),
        ));
    }
    let relay = input.launch.executables.platform == SandboxPlatform::Linux;
    let mut runtime_roots = input.launch.runtime_roots.to_vec();
    let mut program = input.command.to_vec();
    if relay {
        let relay_program = input
            .relay
            .first()
            .ok_or_else(|| SandboxError::Invalid("the terminal relay command is empty".into()))?;
        // The relay must stay readable when the profile denies the home
        // directory, as it does for a development build.
        runtime_roots.extend(Path::new(relay_program).parent().map(Path::to_path_buf));
        program.splice(0..0, input.relay.iter().cloned());
    }
    let resolved = resolve_sandbox(&SandboxLaunchInput {
        adapter: SandboxAdapter::Terminal,
        runtime_roots: &runtime_roots,
        ..input.launch
    })?;
    prepare_sandbox(&resolved)?;
    let settings_file = resolved.host_directory.join("srt-settings.json");
    write_private_file(
        &settings_file,
        &serde_json::to_vec_pretty(&resolved.policy.runtime_config)
            .expect("runtime configuration is serializable"),
    )?;

    // sandbox-runtime replaces TMPDIR with its shared directory and sends
    // loopback and private addresses around its proxy, so the command
    // restores both before the program starts. Core dumps could write process
    // memory into the workspace.
    let no_proxy = shell_quote(&resolved.policy.no_proxy);
    let program = program
        .iter()
        .map(|word| shell_quote(word))
        .collect::<Vec<_>>()
        .join(" ");
    // Without the relay, the standard streams are Pau's PTY under its device
    // name, which the profile denies. Reopening them as `/dev/tty` leaves no
    // descriptor that names a terminal device.
    let streams = if relay {
        ""
    } else {
        "exec </dev/tty >/dev/tty 2>/dev/tty; "
    };
    let command = format!(
        "ulimit -c 0; export TMPDIR={}; export NO_PROXY={no_proxy} no_proxy={no_proxy}; \
         {streams}exec {program}",
        shell_quote(&resolved.policy.temp_dir),
    );

    let mut environment: Vec<(OsString, OsString)> = resolved
        .policy
        .environment
        .iter()
        .map(|(name, value)| (name.into(), value.into()))
        .collect();
    environment.push(("SHELL".into(), input.shell.into()));
    Ok(TerminalSandboxLaunch {
        effective: resolved.effective,
        placeholders: resolved.placeholders,
        program: srt.path.clone(),
        args: vec![
            "--settings".to_owned(),
            settings_file.to_string_lossy().into_owned(),
            "-c".to_owned(),
            command,
        ],
        environment,
        relay,
    })
}

/// Quotes `value` as one POSIX shell word.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs};

    use super::*;
    use crate::sandbox::{
        SandboxCredentialReference, SandboxProfileName, SandboxSettings,
        fixtures::{executables, fixture},
    };

    fn prepare(
        settings: &SandboxSettings,
        executables: &super::super::SandboxExecutables,
    ) -> Result<(TerminalSandboxLaunch, crate::sandbox::fixtures::Fixture), SandboxError> {
        let fixture = fixture();
        // A development build sits under the home directory.
        let bin = fixture.home.join("bin");
        fs::create_dir_all(&bin).unwrap();
        let relay = vec![
            bin.join("pau-term").to_string_lossy().into_owned(),
            "--pau-term-relay".to_owned(),
        ];
        let launch = prepare_terminal_sandbox(&TerminalSandboxInput {
            launch: SandboxLaunchInput {
                adapter: SandboxAdapter::Pi,
                settings,
                workspace: &fixture.workspace,
                home: &fixture.home,
                session_directory: &fixture.session,
                executables,
                runtime_roots: &[],
                tool_path: "/usr/bin:/bin",
                credential_environment: &BTreeMap::new(),
            },
            relay: &relay,
            command: &["/bin/zsh".to_owned()],
            shell: "/bin/zsh",
        })?;
        Ok((launch, fixture))
    }

    #[test]
    fn starts_the_relay_under_srt_with_the_profile() {
        let mut settings = SandboxSettings::workspace_write();
        settings.home_read_deny = true;
        let (launch, fixture) = prepare(&settings, &executables()).unwrap();

        assert_eq!(launch.program, "/pinned/srt");
        assert_eq!(launch.args[0], "--settings");
        let settings_file = PathBuf::from(&launch.args[1]);
        assert!(settings_file.starts_with(fixture.session.join("host")));
        let config: serde_json::Value =
            serde_json::from_slice(&fs::read(&settings_file).unwrap()).unwrap();
        assert!(launch.relay);
        assert_eq!(config["network"]["allowedDomains"], serde_json::json!([]));
        let bin = fixture.home.join("bin");
        let allow_read = config["filesystem"]["allowRead"].to_string();
        assert!(allow_read.contains(&*bin.to_string_lossy()), "{allow_read}");

        assert_eq!(launch.args[2], "-c");
        let temp = fixture.session.join("tmp");
        assert!(launch.args[3].starts_with("ulimit -c 0; "));
        assert!(launch.args[3].contains(&format!("export TMPDIR='{}'", temp.display())));
        assert!(
            launch.args[3].ends_with(&format!(
                "exec '{}' '--pau-term-relay' '/bin/zsh'",
                bin.join("pau-term").display()
            )),
            "{}",
            launch.args[3]
        );

        let environment: BTreeMap<_, _> = launch.environment.iter().cloned().collect();
        assert_eq!(environment[&OsString::from("TERM")], "xterm-256color");
        assert_eq!(environment[&OsString::from("SHELL")], "/bin/zsh");
        assert_eq!(environment[&OsString::from("PATH")], "/usr/bin:/bin");
        assert_eq!(launch.effective.adapter, SandboxAdapter::Terminal);
        assert_eq!(launch.effective.profile, SandboxProfileName::WorkspaceWrite);
        assert!(
            launch
                .effective
                .executables
                .iter()
                .any(|executable| executable.name == "srt")
        );
    }

    #[test]
    fn runs_the_shell_on_dev_tty_on_macos() {
        let mut executables = executables();
        executables.platform = crate::sandbox::executables::SandboxPlatform::MacOs;
        executables.bubblewrap = None;
        executables.socat = None;
        let (launch, _fixture) =
            prepare(&SandboxSettings::workspace_write(), &executables).unwrap();

        assert!(!launch.relay);
        assert!(
            launch.args[3].ends_with("; exec </dev/tty >/dev/tty 2>/dev/tty; exec '/bin/zsh'"),
            "{}",
            launch.args[3]
        );
        assert!(!launch.args[3].contains("--pau-term-relay"));
    }

    #[test]
    fn leaves_brokered_credentials_out_of_terminals() {
        let mut settings = SandboxSettings::workspace_write();
        settings.credential_references = vec![SandboxCredentialReference {
            source: "GITHUB_TOKEN".into(),
            shape: Default::default(),
            destinations: vec!["api.github.com".into()],
        }];
        // The credential source is absent from the host environment, which
        // would refuse an agent launch.
        let (launch, _fixture) = prepare(&settings, &executables()).unwrap();
        assert!(
            launch
                .environment
                .iter()
                .all(|(name, _)| name != "GITHUB_TOKEN")
        );
        assert!(launch.effective.credentials.brokered.is_empty());
        assert!(
            launch
                .effective
                .known_gaps
                .iter()
                .any(|gap| gap.contains("Credential brokerage"))
        );
    }

    #[test]
    fn refuses_to_start_without_srt() {
        let mut executables = executables();
        executables.srt = None;
        let Err(error) = prepare(&SandboxSettings::workspace_write(), &executables) else {
            panic!("a terminal started without srt");
        };
        assert!(matches!(error, SandboxError::Executable(_)), "{error}");
    }

    #[test]
    fn quotes_shell_words() {
        assert_eq!(shell_quote("it's"), r"'it'\''s'");
        assert_eq!(shell_quote(""), "''");
    }
}
