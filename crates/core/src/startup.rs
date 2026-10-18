//! Desktop startup progress, as the shell reports it to the main window.
//!
//! The desktop shell opens its window before the backend is ready and reports
//! each startup step through Tauri, not HTTP, because the page has no backend
//! connection until startup hands one over in [`StartupProgress::connection`].

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::readiness::AgentReadinessReport;

/// One unit of startup work, listed in the order startup runs them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum StartupStepId {
    /// Read the login shell `PATH` so Pi and other tools resolve as they do
    /// in a terminal. macOS only. Other platforms report it done.
    LoginShellPath,
    /// Open the Pau database and apply migrations.
    Database,
    /// Start the local API server.
    Backend,
    /// Check whether each supported agent can start a session.
    AgentReadiness,
}

/// Where a startup step stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum StartupStepState {
    /// The step has not started.
    Pending,
    /// The step is running.
    Running,
    /// The step finished successfully.
    Done,
    /// The step failed. [`StartupProgress::phase`] says whether the app can
    /// still open.
    Failed,
}

/// What the person using Pau can do about a failed step.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum StartupAction {
    /// Pi is missing. Open a terminal and install it.
    InstallPi,
    /// The installed Pi is too old. Open a terminal and update it.
    UpdatePi,
    /// Pi is installed but cannot list models. Run `pi` in a terminal to sign
    /// in or see what it is waiting on.
    RunPi,
    /// The database belongs to a newer Pau. Install that version or newer.
    UpdatePau,
}

/// The state of one startup step.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct StartupStep {
    /// Which step this is.
    pub id: StartupStepId,
    /// Where the step stands.
    pub state: StartupStepState,
    /// Why the step failed, written for the person using Pau. Set only when
    /// `state` is `failed`.
    pub reason: Option<String>,
    /// What the person can do about the failure, when Pau can offer an action.
    pub action: Option<StartupAction>,
}

/// Whether the app can open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum StartupPhase {
    /// Startup work is still running.
    Running,
    /// Startup finished and the connection is available. Steps that do not
    /// stop the app, such as agent readiness, may still have failed.
    Ready,
    /// A required step failed and the app cannot open.
    Failed,
}

/// The local API the page talks to once startup is ready.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DesktopConnection {
    /// The backend's loopback origin, such as `http://127.0.0.1:43127`.
    pub api_origin: String,
    /// The bearer token for this launch.
    pub token: String,
}

/// A full snapshot of desktop startup.
///
/// Every update carries the whole state, so a page that subscribes late
/// misses nothing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct StartupProgress {
    /// Whether the app can open.
    pub phase: StartupPhase,
    /// Every step in the order startup runs them.
    pub steps: Vec<StartupStep>,
    /// The backend connection. Set once the backend is serving requests.
    pub connection: Option<DesktopConnection>,
    /// The agent readiness report, once the check finishes.
    pub readiness: Option<AgentReadinessReport>,
}

impl StartupProgress {
    /// Returns progress with every step pending.
    pub fn new() -> Self {
        Self {
            phase: StartupPhase::Running,
            steps: [
                StartupStepId::LoginShellPath,
                StartupStepId::Database,
                StartupStepId::Backend,
                StartupStepId::AgentReadiness,
            ]
            .into_iter()
            .map(|id| StartupStep {
                id,
                state: StartupStepState::Pending,
                reason: None,
                action: None,
            })
            .collect(),
            connection: None,
            readiness: None,
        }
    }

    /// Returns the step with this identifier.
    pub fn step(&self, id: StartupStepId) -> &StartupStep {
        self.steps
            .iter()
            .find(|step| step.id == id)
            .expect("progress lists every step")
    }

    /// Returns the step with this identifier for an update.
    pub fn step_mut(&mut self, id: StartupStepId) -> &mut StartupStep {
        self.steps
            .iter_mut()
            .find(|step| step.id == id)
            .expect("progress lists every step")
    }
}

impl Default for StartupProgress {
    fn default() -> Self {
        Self::new()
    }
}
