//! `GET /api/agents/readiness`: whether each supported agent can start a
//! session.
//!
//! The check is read-only and bounded. Each agent is located with the same
//! discovery a session launch uses, so it honours the process `PATH` as it
//! is. A found, supported Pi is then started in `--mode rpc` for one
//! `get_available_models` request and shut down, all within
//! [`MODEL_CHECK_TIMEOUT`]. Claude is ready once Claude Code runs a supported
//! version and the Claude bridge is installed; it has no model check. No
//! session is created and no model is called.
//!
//! The report is cached for [`CACHE_LIFETIME`] so startup progress and the
//! first-run view can both ask without launching Pi twice. Concurrent
//! callers share one check. `?refresh=true` skips the cache for a "check
//! again" action.
//!
//! The report has one entry per [`AgentKind`], in the order of
//! [`AgentKind::ALL`], so adding an agent changes no client.

use std::time::{Duration, Instant};

use axum::{
    Json,
    extract::{Query, State},
};
use pau_agent::{AgentKind, ClaudeDiscoveryErrorCode, DiscoverClaudeOptions, discover_claude};
use pau_core::readiness::{AgentReadiness, AgentReadinessReport};
use pau_pi::{
    DiscoverPiOptions, MIN_SUPPORTED_PI_VERSION, PiDiscoveryErrorCode, PiProcess,
    PiShutdownTimeouts, StartPiProcessOptions, discover_pi,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{ApiError, ApiState, SessionApi, session_api};

#[cfg(all(test, unix))]
mod tests;

/// How long a report is reused before Pi is checked again.
const CACHE_LIFETIME: Duration = Duration::from_secs(30);

/// How long Pi may take to start and list its models.
const MODEL_CHECK_TIMEOUT: Duration = Duration::from_secs(10);

/// Query of the readiness route.
#[derive(Deserialize)]
pub(crate) struct ReadinessQuery {
    /// Ignore the cached report and check again.
    #[serde(default)]
    refresh: bool,
}

/// Reports whether each supported agent is installed, supported, and usable.
pub(crate) async fn get_agent_readiness(
    State(state): State<ApiState>,
    Query(query): Query<ReadinessQuery>,
) -> Result<Json<AgentReadinessReport>, ApiError> {
    Ok(Json(session_api(&state)?.readiness(query.refresh).await))
}

impl SessionApi {
    /// Returns the cached report, or checks every agent when it is stale.
    pub(crate) async fn readiness(&self, refresh: bool) -> AgentReadinessReport {
        let mut cache = self.readiness.lock().await;
        if !refresh
            && let Some((checked_at, report)) = cache.as_ref()
            && checked_at.elapsed() < CACHE_LIFETIME
        {
            return report.clone();
        }
        let mut agents = Vec::new();
        for agent in AgentKind::ALL {
            agents.push(match agent {
                AgentKind::Pi => check_pi(self.discovery.clone()).await,
                AgentKind::Claude => check_claude(self.claude_discovery.clone()).await,
            });
        }
        let report = AgentReadinessReport { agents };
        *cache = Some((Instant::now(), report.clone()));
        report
    }
}

async fn check_pi(discovery: DiscoverPiOptions) -> AgentReadiness {
    let mut readiness = AgentReadiness {
        agent: "pi".to_owned(),
        found: false,
        executable_path: None,
        version: None,
        version_supported: false,
        model_count: None,
        ready: false,
        reason: None,
    };
    let working_directory = discovery.working_directory.clone();
    let discovered = match tokio::task::spawn_blocking(move || discover_pi(&discovery)).await {
        Ok(discovered) => discovered,
        Err(error) => {
            readiness.reason = Some(format!("Pi could not be checked: {error}."));
            return readiness;
        }
    };
    let pi = match discovered {
        Ok(pi) => pi,
        Err(error) => {
            let code = error.code();
            readiness.found = !matches!(
                code,
                PiDiscoveryErrorCode::NotFound | PiDiscoveryErrorCode::NotExecutable
            );
            readiness.executable_path = error
                .executable_path()
                .map(|path| path.display().to_string());
            readiness.version = error.version().map(ToString::to_string);
            readiness.reason = Some(error.to_string());
            return readiness;
        }
    };
    readiness.found = true;
    readiness.executable_path = Some(pi.executable_path.display().to_string());
    readiness.version = Some(pi.version.to_string());
    readiness.version_supported = true;

    match count_models(pi.executable_path, working_directory).await {
        Ok(0) => {
            readiness.model_count = Some(0);
            readiness.reason = Some(
                "Pi has no models available. Sign in to a provider or add an API key in Pi, then check again."
                    .to_owned(),
            );
        }
        Ok(count) => {
            readiness.model_count = Some(count);
            readiness.ready = true;
        }
        Err(reason) => readiness.reason = Some(reason),
    }
    readiness
}

async fn check_claude(discovery: DiscoverClaudeOptions) -> AgentReadiness {
    let mut readiness = AgentReadiness {
        agent: AgentKind::Claude.id().to_owned(),
        found: false,
        executable_path: None,
        version: None,
        version_supported: false,
        model_count: None,
        ready: false,
        reason: None,
    };
    let discovered = match tokio::task::spawn_blocking(move || discover_claude(&discovery)).await {
        Ok(discovered) => discovered,
        Err(error) => {
            readiness.reason = Some(format!("Claude Code could not be checked: {error}."));
            return readiness;
        }
    };
    match discovered {
        Ok(claude) => {
            readiness.found = true;
            readiness.executable_path = Some(claude.executable_path.display().to_string());
            readiness.version = Some(claude.version.to_string());
            readiness.version_supported = true;
            readiness.ready = true;
        }
        Err(error) => {
            let code = error.code();
            readiness.found = !matches!(
                code,
                ClaudeDiscoveryErrorCode::NotFound | ClaudeDiscoveryErrorCode::NotExecutable
            );
            // A missing bridge is found only after the version passed.
            readiness.version_supported = matches!(
                code,
                ClaudeDiscoveryErrorCode::BridgeNotFound
                    | ClaudeDiscoveryErrorCode::BridgeNotExecutable
            );
            readiness.executable_path = error
                .executable_path()
                .map(|path| path.display().to_string());
            readiness.version = error.version().map(ToString::to_string);
            readiness.reason = Some(error.to_string());
        }
    }
    readiness
}

/// Asks a short-lived `pi --mode rpc` how many models it can use.
async fn count_models(
    executable_path: std::path::PathBuf,
    working_directory: std::path::PathBuf,
) -> Result<u32, String> {
    let process = PiProcess::start(StartPiProcessOptions {
        executable_path,
        working_directory,
        arguments: Vec::new(),
        environment: Vec::new(),
        shutdown_timeouts: PiShutdownTimeouts {
            protocol: Duration::from_millis(500),
            interrupt: Duration::from_millis(500),
            terminate: Duration::from_millis(500),
            kill: Duration::from_millis(500),
        },
    })
    .map_err(|error| format!("Pi could not start to list its models: {error}."))?;
    let response = tokio::time::timeout(
        MODEL_CHECK_TIMEOUT,
        process.command(json!({"type": "get_available_models"})),
    )
    .await;
    // Shutdown is best effort: the answer, or its absence, is what matters.
    let _ = process.shutdown().await;
    let response = response
        .map_err(|_| {
            format!(
                "Pi did not list its models within {} seconds. Run `pi` in a terminal to see what it is waiting on.",
                MODEL_CHECK_TIMEOUT.as_secs()
            )
        })?
        .map_err(|error| format!("Pi could not list its models: {error}."))?;
    if response.get("success").and_then(Value::as_bool) == Some(false) {
        let detail = response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("it reported an error");
        return Err(format!("Pi could not list its models: {detail}."));
    }
    response
        .get("data")
        .and_then(|data| data.get("models"))
        .and_then(Value::as_array)
        .map(|models| u32::try_from(models.len()).unwrap_or(u32::MAX))
        .ok_or_else(|| {
            format!(
                "Pi returned an unexpected model list. Update Pi to {MIN_SUPPORTED_PI_VERSION} or newer."
            )
        })
}
