//! Startup work that runs after the main window opens.
//!
//! The window appears first and shows progress while the shell reads the
//! login shell `PATH`, opens the database, starts the backend, and checks
//! agent readiness. Each change replaces the whole [`StartupProgress`]
//! snapshot and is published to the window, and the `startup_progress`
//! command returns the current snapshot, so a page that loads late still sees
//! every step.
//!
//! The backend connection reaches the page only through that snapshot, once
//! the backend serves requests. The token never appears in a URL.
//!
//! The shell never changes its own environment: its runtime and WebKit
//! threads may read it at any time, and changing it then is undefined
//! behavior. The `PATH` the first step resolves goes to the backend instead,
//! which gives it to every child process it starts.

use std::{
    env,
    error::Error,
    ffi::OsString,
    future::Future,
    io,
    net::Ipv4Addr,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use pau_core::{
    persistence::OpenError,
    readiness::AgentReadinessReport,
    startup::{
        DesktopConnection, StartupAction, StartupPhase, StartupProgress, StartupStepId,
        StartupStepState,
    },
};
use pau_server::{ApiToken, ServerDatabase, ServerHandle, ServerOptions};

/// The event that carries each new snapshot to the main window.
pub const PROGRESS_EVENT: &str = "pau://startup-progress";

/// How long a fatal failure waits for the page to show it before the shell
/// falls back to a native dialog.
pub const PAGE_TIMEOUT: Duration = Duration::from_secs(10);

/// Why a step failed and what the person can do about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepFailure {
    /// The reason, written as a sentence for the person using Pau.
    pub reason: String,
    /// The action Pau can offer, when one helps.
    pub action: Option<StartupAction>,
}

impl StepFailure {
    /// Describes an error without an action.
    fn from_error(error: &dyn Error) -> Self {
        Self {
            reason: sentence(error),
            action: None,
        }
    }
}

/// The `PATH` the backend and its child processes receive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessPath {
    /// The login shell's entries ahead of the inherited ones, or only the
    /// inherited ones when the login shell could not report its own.
    pub path: OsString,
    /// Why the login shell's `PATH` could not be used, if it could not.
    pub failure: Option<StepFailure>,
}

/// The work behind the startup steps.
///
/// [`PauLauncher`] runs the real backend. Tests substitute their own steps.
pub trait Launcher: Sync {
    /// The opened database that the backend step takes over.
    type Database: Send;

    /// Resolves the `PATH` for the backend. Never stops startup.
    fn read_path(&self) -> impl Future<Output = ProcessPath> + Send;

    /// Opens and migrates the database.
    fn open_database(&self) -> impl Future<Output = Result<Self::Database, StepFailure>> + Send;

    /// Starts the backend on the opened database with `path` as the `PATH`
    /// of every child process, and returns its connection.
    fn start_backend(
        &self,
        database: Self::Database,
        path: OsString,
    ) -> impl Future<Output = Result<DesktopConnection, StepFailure>> + Send;

    /// Checks every supported agent. Called only after the backend started.
    fn check_agents(&self) -> impl Future<Output = AgentReadinessReport> + Send;
}

/// Startup progress shared by the startup task and the `startup_progress`
/// command.
pub struct StartupState {
    progress: Mutex<StartupProgress>,
    page_attached: AtomicBool,
}

impl StartupState {
    /// Starts with every step pending.
    pub fn new() -> Self {
        Self {
            progress: Mutex::new(StartupProgress::new()),
            page_attached: AtomicBool::new(false),
        }
    }

    /// Returns the current snapshot.
    pub fn snapshot(&self) -> StartupProgress {
        self.progress
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Records that a page subscribed to progress and asked for a snapshot,
    /// so it will show a later failure itself.
    pub fn attach_page(&self) {
        self.page_attached.store(true, Ordering::SeqCst);
    }

    /// Waits up to `timeout` for a page to attach and reports whether one did.
    pub async fn wait_for_page(&self, timeout: Duration) -> bool {
        let poll = Duration::from_millis(50);
        let mut waited = Duration::ZERO;
        while !self.page_attached.load(Ordering::SeqCst) {
            if waited >= timeout {
                return false;
            }
            tokio::time::sleep(poll).await;
            waited += poll;
        }
        true
    }

    /// Applies `change` and publishes the resulting snapshot.
    fn update(
        &self,
        publish: &impl Fn(&StartupProgress),
        change: impl FnOnce(&mut StartupProgress),
    ) {
        let snapshot = {
            let mut progress = self
                .progress
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            change(&mut progress);
            progress.clone()
        };
        publish(&snapshot);
    }

    fn set_step(
        &self,
        publish: &impl Fn(&StartupProgress),
        id: StartupStepId,
        state: StartupStepState,
        failure: Option<StepFailure>,
    ) {
        self.update(publish, |progress| {
            let step = progress.step_mut(id);
            step.state = state;
            step.reason = failure.as_ref().map(|failure| failure.reason.clone());
            step.action = failure.and_then(|failure| failure.action);
        });
    }
}

/// Runs the login shell `PATH`, database, backend, and agent readiness steps
/// in order.
///
/// The backend starts only once the `PATH` is known, so agent readiness and
/// every child process use it. A login shell failure fails its step and
/// keeps the inherited `PATH`. A database or backend failure stops startup,
/// marks the phase failed, and returns the reason. Agent readiness never
/// stops startup: a missing or unusable agent fails its step, and the phase
/// still becomes ready.
pub async fn run<L: Launcher>(
    launcher: &L,
    state: &StartupState,
    publish: impl Fn(&StartupProgress),
) -> Result<(), String> {
    let fail = |id, failure: StepFailure| {
        let reason = failure.reason.clone();
        state.set_step(&publish, id, StartupStepState::Failed, Some(failure));
        state.update(&publish, |progress| progress.phase = StartupPhase::Failed);
        reason
    };

    state.set_step(
        &publish,
        StartupStepId::LoginShellPath,
        StartupStepState::Running,
        None,
    );
    let ProcessPath { path, failure } = launcher.read_path().await;
    let login_state = match failure {
        None => StartupStepState::Done,
        Some(_) => StartupStepState::Failed,
    };
    state.set_step(
        &publish,
        StartupStepId::LoginShellPath,
        login_state,
        failure,
    );

    state.set_step(
        &publish,
        StartupStepId::Database,
        StartupStepState::Running,
        None,
    );
    let database = launcher
        .open_database()
        .await
        .map_err(|failure| fail(StartupStepId::Database, failure))?;
    state.set_step(
        &publish,
        StartupStepId::Database,
        StartupStepState::Done,
        None,
    );

    state.set_step(
        &publish,
        StartupStepId::Backend,
        StartupStepState::Running,
        None,
    );
    let connection = launcher
        .start_backend(database, path)
        .await
        .map_err(|failure| fail(StartupStepId::Backend, failure))?;
    state.update(&publish, |progress| {
        let step = progress.step_mut(StartupStepId::Backend);
        step.state = StartupStepState::Done;
        progress.connection = Some(connection);
    });

    state.set_step(
        &publish,
        StartupStepId::AgentReadiness,
        StartupStepState::Running,
        None,
    );
    let report = launcher.check_agents().await;
    let failure = readiness_failure(&report);
    state.update(&publish, |progress| {
        let step = progress.step_mut(StartupStepId::AgentReadiness);
        match failure {
            None => step.state = StartupStepState::Done,
            Some(failure) => {
                step.state = StartupStepState::Failed;
                step.reason = Some(failure.reason);
                step.action = failure.action;
            }
        }
        progress.readiness = Some(report);
        progress.phase = StartupPhase::Ready;
    });
    Ok(())
}

/// Describes why Pi cannot start a session, if it cannot.
///
/// The desktop starts Pi sessions only, so another agent that is not ready
/// does not fail the step.
fn readiness_failure(report: &AgentReadinessReport) -> Option<StepFailure> {
    let agent = report
        .agents
        .iter()
        .find(|agent| agent.agent == "pi" && !agent.ready)?;
    let action = Some(if !agent.found {
        StartupAction::InstallPi
    } else if !agent.version_supported {
        StartupAction::UpdatePi
    } else {
        StartupAction::RunPi
    });
    Some(StepFailure {
        reason: agent
            .reason
            .clone()
            .unwrap_or_else(|| "Pi cannot start a session.".to_owned()),
        action,
    })
}

/// Describes why the login shell `PATH` could not be read.
///
/// The failure only means Pau keeps the `PATH` it was opened with, so it
/// never stops startup.
#[cfg(target_os = "macos")]
fn login_path_failure(error: crate::login_path::LoginPathError) -> StepFailure {
    use crate::login_path::{LoginPathError, TIMEOUT};

    let reason = match error {
        LoginPathError::TimedOut => format!(
            "Your login shell took longer than {} seconds to report its PATH, so Pau kept \
             the PATH it was opened with. Pi and other tools may not be found.",
            TIMEOUT.as_secs()
        ),
        LoginPathError::Unavailable => "Pau could not read your login shell's PATH, \
             so it kept the PATH it was opened with. Pi and other tools may not be found."
            .to_owned(),
    };
    StepFailure {
        reason,
        action: None,
    }
}

/// Turns an error into text that starts with a capital letter.
///
/// Backend errors begin in lowercase so they read well inside logs and wrapped
/// errors. Progress and the dialog show the message on its own.
pub fn sentence(error: &dyn Error) -> String {
    let text = error.to_string();
    let mut characters = text.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => "Pau stopped during startup without reporting a reason.".to_owned(),
    }
}

/// Runs the real login shell, database, backend, and agent check, and owns
/// the backend for as long as the app runs.
pub struct PauLauncher {
    /// The database file, or `None` for the backend's default location.
    database_path: Option<PathBuf>,
    /// Backend options. The backend step fills in `path`.
    options: ServerOptions,
    /// The login shell, from `SHELL` or `/bin/zsh`.
    #[cfg(target_os = "macos")]
    shell: OsString,
    /// The `PATH` the app was opened with.
    inherited_path: OsString,
    server: Mutex<Option<ServerHandle>>,
}

impl PauLauncher {
    /// Creates a launcher for the database at `database_path`, or at the
    /// default location when `None`.
    pub fn new(database_path: Option<PathBuf>, options: ServerOptions) -> Self {
        Self {
            database_path,
            options,
            #[cfg(target_os = "macos")]
            shell: env::var_os("SHELL").unwrap_or_else(|| OsString::from("/bin/zsh")),
            inherited_path: env::var_os("PATH").unwrap_or_default(),
            server: Mutex::new(None),
        }
    }

    /// Replaces the login shell and the inherited `PATH`, so tests can run a
    /// fake shell whatever environment started the test.
    #[cfg(all(test, target_os = "macos"))]
    fn with_shell(mut self, shell: OsString, inherited_path: &str) -> Self {
        self.shell = shell;
        self.inherited_path = inherited_path.into();
        self
    }

    /// Shuts a started backend down and waits until its sessions and
    /// terminals have stopped and its audit records are stored, or until
    /// [`pau_server::SHUTDOWN_LIMIT`] passes. Does nothing before it starts.
    ///
    /// The app awaits this before its async runtime ends, which would
    /// otherwise cancel the backend's tasks with records still queued.
    pub async fn shutdown(&self) {
        let server = self
            .server
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(server) = server
            && let Err(error) = server.shutdown().await
        {
            tracing::warn!(%error, "the Pau backend stopped with an error");
        }
    }
}

impl Launcher for PauLauncher {
    type Database = ServerDatabase;

    /// Asks the login shell for its `PATH` on macOS, off the async runtime,
    /// and puts it ahead of the inherited one. An inherited `PATH` that a shell
    /// already built, and other platforms, keep the inherited `PATH`.
    async fn read_path(&self) -> ProcessPath {
        let inherited = self.inherited_path.clone();
        #[cfg(target_os = "macos")]
        {
            use crate::login_path::{
                LoginPathError, TIMEOUT, inherits_shell_path, merge_paths, shell_path,
            };

            if inherits_shell_path(&inherited) {
                tracing::debug!("the inherited PATH comes from a shell; keeping it");
                return ProcessPath {
                    path: inherited,
                    failure: None,
                };
            }
            let shell = self.shell.clone();
            let login = tokio::task::spawn_blocking(move || shell_path(&shell, TIMEOUT))
                .await
                .unwrap_or(Err(LoginPathError::Unavailable));
            match login {
                Ok(login) => ProcessPath {
                    path: merge_paths(&login, &inherited).unwrap_or(inherited),
                    failure: None,
                },
                Err(error) => {
                    tracing::warn!(
                        ?error,
                        "could not read the login shell PATH; keeping the inherited PATH"
                    );
                    ProcessPath {
                        path: inherited,
                        failure: Some(login_path_failure(error)),
                    }
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        ProcessPath {
            path: inherited,
            failure: None,
        }
    }

    async fn open_database(&self) -> Result<ServerDatabase, StepFailure> {
        let opened = match &self.database_path {
            Some(path) => pau_server::open_database_at(path).await,
            None => pau_server::open_database().await,
        };
        opened.map_err(|error| database_failure(&error))
    }

    async fn start_backend(
        &self,
        database: ServerDatabase,
        path: OsString,
    ) -> Result<DesktopConnection, StepFailure> {
        let token = ApiToken::generate().map_err(|error| StepFailure::from_error(&error))?;
        let options = ServerOptions {
            path: Some(path),
            ..self.options.clone()
        };
        let server = pau_server::start_with_database(
            (Ipv4Addr::LOCALHOST, 0).into(),
            token,
            options,
            database,
        )
        .await
        .map_err(|error| StepFailure::from_error(&error))?;
        let connection = DesktopConnection {
            api_origin: format!("http://127.0.0.1:{}", server.local_addr().port()),
            token: server.token().expose().to_owned(),
        };
        *self
            .server
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(server);
        Ok(connection)
    }

    async fn check_agents(&self) -> AgentReadinessReport {
        let check = self
            .server
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(ServerHandle::agent_readiness);
        match check {
            Some(check) => check.await,
            None => AgentReadinessReport { agents: Vec::new() },
        }
    }
}

/// Offers an update when the database belongs to a newer Pau.
fn database_failure(error: &io::Error) -> StepFailure {
    let newer = matches!(
        error
            .get_ref()
            .and_then(|inner| inner.downcast_ref::<OpenError>()),
        Some(OpenError::NewerSchema { .. })
    );
    StepFailure {
        reason: sentence(error),
        action: newer.then_some(StartupAction::UpdatePau),
    }
}

#[cfg(test)]
mod tests;
