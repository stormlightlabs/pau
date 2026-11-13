use std::{sync::Mutex, time::Duration};

use pau_core::{
    readiness::{AgentReadiness, AgentReadinessReport},
    startup::{
        DesktopConnection, StartupAction, StartupPhase, StartupProgress, StartupStepId,
        StartupStepState,
    },
};
use pau_server::ServerOptions;
use tokio_rusqlite::rusqlite::Connection;

use super::{Launcher, PauLauncher, StartupState, StepFailure, run};

const TOKEN: &str = "abcdefghijklmnopqrstuvwxyz0123456789";

/// Steps that succeed at once and report the agents they are given.
struct FakeLauncher {
    agents: Vec<AgentReadiness>,
}

impl Launcher for FakeLauncher {
    type Database = ();

    async fn open_database(&self) -> Result<(), StepFailure> {
        Ok(())
    }

    async fn start_backend(&self, (): ()) -> Result<DesktopConnection, StepFailure> {
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
    let state = StartupState::new(Ok(()));
    let launcher = FakeLauncher {
        agents: vec![pi(true)],
    };

    let (result, snapshots) = run_recorded(&launcher, &state).await;

    assert_eq!(result, Ok(()));
    assert_eq!(
        transitions(&snapshots),
        [
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
}

#[tokio::test]
async fn reports_a_missing_pi_and_still_opens() {
    let state = StartupState::new(Ok(()));
    let launcher = FakeLauncher {
        agents: vec![pi(false)],
    };

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
    let state = StartupState::new(Ok(()));
    let launcher = FakeLauncher {
        agents: vec![pi(true), claude],
    };

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
        let state = StartupState::new(Ok(()));
        run_recorded(
            &FakeLauncher {
                agents: vec![agent],
            },
            &state,
        )
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
    let login = super::login_path_outcome(Err(crate::login_path::LoginPathError::TimedOut));
    #[cfg(not(target_os = "macos"))]
    let login = Err(StepFailure {
        reason: "Your login shell took too long.".to_owned(),
        action: None,
    });
    let state = StartupState::new(login);
    let launcher = FakeLauncher {
        agents: vec![pi(true)],
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
}

#[tokio::test]
async fn reports_a_database_from_a_newer_version_and_stops() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pau.sqlite3");
    Connection::open(&path)
        .unwrap()
        .pragma_update(None, "user_version", 999)
        .unwrap();
    let state = StartupState::new(Ok(()));
    let launcher = PauLauncher::new(Some(path), ServerOptions::default());

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
    let state = StartupState::new(Ok(()));
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
