use std::{ffi::OsString, sync::Mutex, time::Duration};

use pau_core::{
    readiness::{AgentReadiness, AgentReadinessReport},
    startup::{
        DesktopConnection, StartupAction, StartupPhase, StartupProgress, StartupStepId,
        StartupStepState,
    },
};
use pau_server::ServerOptions;
use tokio::sync::Semaphore;
use tokio_rusqlite::rusqlite::Connection;

use super::{Launcher, PauLauncher, ProcessPath, StartupState, StepFailure, run};

const TOKEN: &str = "abcdefghijklmnopqrstuvwxyz0123456789";
const LOGIN_PATH: &str = "/login/bin:/usr/bin";

/// Steps that succeed at once and report the agents they are given.
struct FakeLauncher {
    agents: Vec<AgentReadiness>,
    /// What the `PATH` step resolves to.
    path: ProcessPath,
    /// Holds the `PATH` step until a permit is available.
    path_gate: Semaphore,
    /// The `PATH` the backend step received.
    backend_path: Mutex<Option<OsString>>,
}

impl FakeLauncher {
    fn new(agents: Vec<AgentReadiness>) -> Self {
        Self {
            agents,
            path: ProcessPath {
                path: LOGIN_PATH.into(),
                failure: None,
            },
            path_gate: Semaphore::new(1),
            backend_path: Mutex::new(None),
        }
    }
}

impl Launcher for FakeLauncher {
    type Database = ();

    async fn read_path(&self) -> ProcessPath {
        let _permit = self.path_gate.acquire().await.unwrap();
        self.path.clone()
    }

    async fn open_database(&self) -> Result<(), StepFailure> {
        Ok(())
    }

    async fn start_backend(
        &self,
        (): (),
        path: OsString,
    ) -> Result<DesktopConnection, StepFailure> {
        *self.backend_path.lock().unwrap() = Some(path);
        Ok(connection())
    }

    async fn check_agents(&self) -> AgentReadinessReport {
        AgentReadinessReport {
            agents: self.agents.clone(),
        }
    }
}

fn connection() -> DesktopConnection {
    DesktopConnection {
        api_origin: "http://127.0.0.1:43127".to_owned(),
        token: TOKEN.to_owned(),
    }
}

fn pi(ready: bool) -> AgentReadiness {
    AgentReadiness {
        agent: "pi".to_owned(),
        found: ready,
        executable_path: ready.then(|| "/opt/bin/pi".to_owned()),
        version: ready.then(|| "0.80.0".to_owned()),
        version_supported: ready,
        model_count: ready.then_some(3),
        ready,
        reason: (!ready).then(|| "Pi was not found on PATH. Install Pi, then check again.".into()),
    }
}

/// Runs startup and returns every published snapshot.
async fn run_recorded<L: Launcher>(
    launcher: &L,
    state: &StartupState,
) -> (Result<(), String>, Vec<StartupProgress>) {
    let published = Mutex::new(Vec::new());
    let result = run(launcher, state, |progress| {
        published.lock().unwrap().push(progress.clone());
    })
    .await;
    (result, published.into_inner().unwrap())
}

/// Lists each step change across snapshots as `(step, state)`.
fn transitions(snapshots: &[StartupProgress]) -> Vec<(StartupStepId, StartupStepState)> {
    let mut changes = Vec::new();
    let mut previous = StartupProgress::new();
    for snapshot in snapshots {
        for (before, after) in previous.steps.iter().zip(&snapshot.steps) {
            if before.state != after.state {
                changes.push((after.id, after.state));
            }
        }
        previous = snapshot.clone();
    }
    changes
}

#[tokio::test]
async fn runs_each_step_in_order_and_hands_over_the_connection_last() {
    let state = StartupState::new();
    let launcher = FakeLauncher::new(vec![pi(true)]);

    let (result, snapshots) = run_recorded(&launcher, &state).await;

    assert_eq!(result, Ok(()));
    assert_eq!(
        transitions(&snapshots),
        [
            (StartupStepId::LoginShellPath, StartupStepState::Running),
            (StartupStepId::LoginShellPath, StartupStepState::Done),
            (StartupStepId::Database, StartupStepState::Running),
            (StartupStepId::Database, StartupStepState::Done),
            (StartupStepId::Backend, StartupStepState::Running),
            (StartupStepId::Backend, StartupStepState::Done),
            (StartupStepId::AgentReadiness, StartupStepState::Running),
            (StartupStepId::AgentReadiness, StartupStepState::Done),
        ]
    );
    for snapshot in &snapshots {
        let backend_done = snapshot.step(StartupStepId::Backend).state == StartupStepState::Done;
        assert_eq!(snapshot.connection.is_some(), backend_done);
    }
    let last = state.snapshot();
    assert_eq!(&last, snapshots.last().unwrap());
    assert_eq!(last.phase, StartupPhase::Ready);
    assert_eq!(last.connection, Some(connection()));
    assert_eq!(last.readiness.unwrap().agents, [pi(true)]);
    assert_eq!(
        launcher.backend_path.lock().unwrap().as_deref(),
        Some(LOGIN_PATH.as_ref())
    );
}

/// The window shows progress while the login shell is still running, and
/// nothing that needs its `PATH` starts before it finishes.
#[tokio::test]
async fn shows_the_path_step_running_and_waits_for_it() {
    let state = StartupState::new();
    let launcher = FakeLauncher {
        path_gate: Semaphore::new(0),
        ..FakeLauncher::new(vec![pi(true)])
    };
    let startup = run_recorded(&launcher, &state);
    tokio::pin!(startup);

    tokio::select! {
        _ = &mut startup => panic!("startup finished before the PATH step"),
        () = tokio::time::sleep(Duration::from_millis(100)) => {}
    }
    let waiting = state.snapshot();
    assert_eq!(
        waiting.step(StartupStepId::LoginShellPath).state,
        StartupStepState::Running
    );
    for id in [
        StartupStepId::Database,
        StartupStepId::Backend,
        StartupStepId::AgentReadiness,
    ] {
        assert_eq!(waiting.step(id).state, StartupStepState::Pending, "{id:?}");
    }
    assert_eq!(waiting.connection, None);
    assert_eq!(*launcher.backend_path.lock().unwrap(), None);

    launcher.path_gate.add_permits(1);
    let (result, _) = startup.await;

    assert_eq!(result, Ok(()));
    assert_eq!(state.snapshot().phase, StartupPhase::Ready);
}

#[tokio::test]
async fn reports_a_missing_pi_and_still_opens() {
    let state = StartupState::new();
    let launcher = FakeLauncher::new(vec![pi(false)]);

    let (result, _) = run_recorded(&launcher, &state).await;

    assert_eq!(result, Ok(()));
    let progress = state.snapshot();
    assert_eq!(progress.phase, StartupPhase::Ready);
    assert_eq!(progress.connection, Some(connection()));
    let step = progress.step(StartupStepId::AgentReadiness);
    assert_eq!(step.state, StartupStepState::Failed);
    assert_eq!(
        step.reason.as_deref(),
        Some("Pi was not found on PATH. Install Pi, then check again.")
    );
    assert_eq!(step.action, Some(StartupAction::InstallPi));
    assert!(!progress.readiness.unwrap().agents[0].ready);
}

#[tokio::test]
async fn ignores_another_agent_that_is_not_ready() {
    let claude = AgentReadiness {
        agent: "claude".to_owned(),
        reason: Some("Claude Code was not found.".to_owned()),
        ..pi(false)
    };
    let state = StartupState::new();
    let launcher = FakeLauncher::new(vec![pi(true), claude]);

    run_recorded(&launcher, &state).await.0.unwrap();

    let step = state.snapshot();
    let step = step.step(StartupStepId::AgentReadiness);
    assert_eq!(step.state, StartupStepState::Done);
    assert_eq!(step.reason, None);
}

#[tokio::test]
async fn offers_a_pi_update_or_a_pi_run_for_other_readiness_failures() {
    let mut outdated = pi(false);
    outdated.found = true;
    let mut no_models = pi(true);
    no_models.ready = false;
    no_models.model_count = Some(0);
    no_models.reason = Some("Pi has no models available.".to_owned());

    for (agent, action) in [
        (outdated, StartupAction::UpdatePi),
        (no_models, StartupAction::RunPi),
    ] {
        let state = StartupState::new();
        run_recorded(&FakeLauncher::new(vec![agent]), &state)
            .await
            .0
            .unwrap();
        let progress = state.snapshot();
        assert_eq!(
            progress.step(StartupStepId::AgentReadiness).action,
            Some(action)
        );
    }
}

#[tokio::test]
async fn a_slow_login_shell_fails_its_step_without_stopping_startup() {
    #[cfg(target_os = "macos")]
    let failure = super::login_path_failure(crate::login_path::LoginPathError::TimedOut);
    #[cfg(not(target_os = "macos"))]
    let failure = StepFailure {
        reason: "Your login shell took too long.".to_owned(),
        action: None,
    };
    let state = StartupState::new();
    let launcher = FakeLauncher {
        path: ProcessPath {
            path: "/usr/bin".into(),
            failure: Some(failure),
        },
        ..FakeLauncher::new(vec![pi(true)])
    };

    let (result, _) = run_recorded(&launcher, &state).await;

    assert_eq!(result, Ok(()));
    let progress = state.snapshot();
    let step = progress.step(StartupStepId::LoginShellPath);
    assert_eq!(step.state, StartupStepState::Failed);
    assert!(
        step.reason
            .as_deref()
            .is_some_and(|reason| reason.starts_with("Your login shell took")),
        "{:?}",
        step.reason
    );
    assert_eq!(progress.phase, StartupPhase::Ready);
    assert_eq!(
        launcher.backend_path.lock().unwrap().as_deref(),
        Some("/usr/bin".as_ref())
    );
}

/// Writes an executable script that stands in for the login shell.
#[cfg(target_os = "macos")]
fn fake_shell(directory: &std::path::Path, body: &str) -> OsString {
    use std::os::unix::fs::PermissionsExt;

    let path = directory.join("shell");
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path.into_os_string()
}

/// A slow login shell runs off the async runtime, which keeps serving other
/// work while it runs, and its `PATH` comes first.
#[cfg(target_os = "macos")]
#[tokio::test]
async fn reads_a_slow_login_shell_off_the_runtime() {
    let directory = tempfile::tempdir().unwrap();
    let shell = fake_shell(
        directory.path(),
        "sleep 1; printf '__PAU_LOGIN_PATH__/login/bin__PAU_LOGIN_PATH__'",
    );
    let launcher = PauLauncher::new(None, ServerOptions::default()).with_shell(shell);
    // The test runtime has one thread, so the ticks advance only while the
    // shell runs elsewhere.
    let ticks = std::cell::Cell::new(0);
    let count = async {
        loop {
            tokio::time::sleep(Duration::from_millis(50)).await;
            ticks.set(ticks.get() + 1);
        }
    };

    let path = tokio::select! {
        path = launcher.read_path() => path,
        () = count => unreachable!(),
    };

    assert!(ticks.get() >= 10, "{} ticks", ticks.get());
    assert_eq!(path.failure, None);
    let entries: Vec<_> = std::env::split_paths(&path.path).collect();
    assert_eq!(
        entries.first(),
        Some(&std::path::PathBuf::from("/login/bin"))
    );
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn keeps_the_inherited_path_when_the_login_shell_reports_none() {
    let directory = tempfile::tempdir().unwrap();
    let shell = fake_shell(directory.path(), "exit 0");
    let launcher = PauLauncher::new(None, ServerOptions::default()).with_shell(shell);

    let path = launcher.read_path().await;

    assert_eq!(path.path, std::env::var_os("PATH").unwrap_or_default());
    let failure = path.failure.unwrap();
    assert!(
        failure
            .reason
            .starts_with("Pau could not read your login shell"),
        "{}",
        failure.reason
    );
}

#[tokio::test]
async fn reports_a_database_from_a_newer_version_and_stops() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pau.sqlite3");
    Connection::open(&path)
        .unwrap()
        .pragma_update(None, "user_version", 999)
        .unwrap();
    let state = StartupState::new();
    let launcher = PauLauncher::new(Some(path), ServerOptions::default());
    // Keep the developer's own login shell out of the test.
    #[cfg(target_os = "macos")]
    let launcher = launcher.with_shell(fake_shell(directory.path(), "exit 0"));

    let (result, snapshots) = run_recorded(&launcher, &state).await;

    let reason = result.unwrap_err();
    assert!(
        reason.starts_with("The Pau database uses schema version 999"),
        "{reason}"
    );
    let progress = state.snapshot();
    assert_eq!(progress.phase, StartupPhase::Failed);
    assert_eq!(progress.connection, None);
    let database = progress.step(StartupStepId::Database);
    assert_eq!(database.state, StartupStepState::Failed);
    assert_eq!(database.reason.as_deref(), Some(reason.as_str()));
    assert_eq!(database.action, Some(StartupAction::UpdatePau));
    assert_eq!(
        progress.step(StartupStepId::Backend).state,
        StartupStepState::Pending
    );
    assert!(
        snapshots.iter().all(
            |snapshot| snapshot.step(StartupStepId::Backend).state == StartupStepState::Pending
        )
    );
}

#[tokio::test]
async fn waits_for_a_page_before_the_dialog_fallback() {
    let state = StartupState::new();
    assert!(!state.wait_for_page(Duration::from_millis(100)).await);

    state.attach_page();
    assert!(state.wait_for_page(Duration::from_millis(100)).await);
}

#[test]
fn sentence_capitalizes_the_backend_error() {
    let error = std::io::Error::other("the Pau database uses schema version 9");

    assert_eq!(
        super::sentence(&error),
        "The Pau database uses schema version 9"
    );
}

#[test]
fn sentence_explains_an_empty_error() {
    assert_eq!(
        super::sentence(&std::io::Error::other("")),
        "Pau stopped during startup without reporting a reason."
    );
}
