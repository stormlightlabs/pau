//! `GET /api/workspaces/{workspace_id}/resources`: the skills, prompts,
//! extensions, themes, and packages Pi finds for a workspace.
//!
//! Discovery only reads files and never starts Pi. Each resource carries the
//! warnings about its own file, and problems that belong to no single
//! resource, such as an unreadable settings file, stay in the index's
//! warnings. Invalid files and name collisions are listed with their status,
//! so one bad file never hides the rest.

use axum::{
    Json,
    extract::{Path as AxumPath, State},
};
use pau_core::agent_resources::{
    AgentResource, AgentResourceIndex, AgentResourceKind, AgentResourceScope,
    AgentResourceSourceKind, AgentResourceStatus, AgentResourceTrust, AgentResourceWarning,
};
use pau_pi::{
    DiscoverPiResourcesOptions, PiProjectTrust, PiResource, PiResourceIndex, PiResourceKind,
    PiResourceScope, PiResourceSource, PiResourceWarning, discover_pi_resources,
    pi_configuration_paths,
};

use super::{ApiError, ApiState, SessionApi, session_api};
use crate::workspace_service;

#[cfg(all(test, unix))]
mod tests;

/// Lists the Pi resources found for a registered workspace.
pub(crate) async fn get_workspace_resources(
    State(state): State<ApiState>,
    AxumPath(workspace_id): AxumPath<String>,
) -> Result<Json<AgentResourceIndex>, ApiError> {
    let api = session_api(&state)?;
    let workspace = workspace_service(&state)?.root(&workspace_id).await?;
    let options = api.resource_options(workspace)?;
    let index = tokio::task::spawn_blocking(move || describe(discover_pi_resources(&options)))
        .await
        .map_err(|error| ApiError::PiUnavailable(error.to_string()))?;
    Ok(Json(index))
}

impl SessionApi {
    /// Pi's home and agent directories, from the discovery settings captured
    /// at startup, with `workspace` as the project.
    fn resource_options(
        &self,
        workspace: std::path::PathBuf,
    ) -> Result<DiscoverPiResourcesOptions, ApiError> {
        let paths = pi_configuration_paths(&self.discovery)
            .map_err(|error| ApiError::PiUnavailable(error.to_string()))?;
        let home_directory = self.discovery.home_directory.clone().ok_or_else(|| {
            ApiError::PiUnavailable(
                "Pi's resources cannot be found because HOME is not set.".into(),
            )
        })?;
        Ok(DiscoverPiResourcesOptions {
            home_directory,
            agent_directory: paths.agent_directory,
            workspace,
        })
    }
}

/// Turns Pi's index into the wire index: ready resources in the order that
/// decides duplicates, then skipped resources, then packages.
fn describe(index: PiResourceIndex) -> AgentResourceIndex {
    let project_trust = match index.project_trust {
        PiProjectTrust::Trusted => AgentResourceTrust::Trusted,
        PiProjectTrust::Declined => AgentResourceTrust::Untrusted,
        PiProjectTrust::Undecided => AgentResourceTrust::Undecided,
    };
    let trust = |scope| match scope {
        PiResourceScope::User => AgentResourceTrust::Trusted,
        PiResourceScope::Project => project_trust,
    };
    let mut warnings = index.warnings;
    let mut resource = |resource: PiResource, status, winner: Option<std::path::PathBuf>| {
        // Claim the warnings about this resource's own file.
        let (own, rest) = warnings
            .drain(..)
            .partition(|warning| warning.kind.is_some() && warning.path == resource.path);
        warnings = rest;
        let (source_kind, source) = match resource.source {
            PiResourceSource::Directory { path } => {
                (AgentResourceSourceKind::Directory, lossy(&path))
            }
            PiResourceSource::Setting { settings_path } => {
                (AgentResourceSourceKind::Setting, lossy(&settings_path))
            }
            PiResourceSource::Package { source } => (AgentResourceSourceKind::Package, source),
        };
        let kind = match resource.kind {
            PiResourceKind::Skill => AgentResourceKind::Skill,
            PiResourceKind::Prompt => AgentResourceKind::Prompt,
            PiResourceKind::Extension => AgentResourceKind::Extension,
            PiResourceKind::Theme => AgentResourceKind::Theme,
        };
        let path = lossy(&resource.path);
        AgentResource {
            id: path.clone(),
            kind,
            name: resource.name,
            description: resource.description,
            path: Some(path),
            scope: scope(resource.scope),
            source_kind,
            source,
            trust: trust(resource.scope),
            status,
            winner: winner.as_deref().map(lossy),
            warnings: own
                .into_iter()
                .map(|warning: PiResourceWarning| warning.message)
                .collect(),
        }
    };
    let mut resources: Vec<AgentResource> = index
        .resources
        .into_iter()
        .map(|loaded| resource(loaded, AgentResourceStatus::Ready, None))
        .collect();
    for skipped in index.skipped {
        let status = if skipped.winner.is_some() {
            AgentResourceStatus::Duplicate
        } else {
            AgentResourceStatus::Invalid
        };
        resources.push(resource(skipped.resource, status, skipped.winner));
    }
    for package in index.packages {
        let missing = !package.installed;
        resources.push(AgentResource {
            id: format!("package:{}:{}", scope_key(package.scope), package.source),
            kind: AgentResourceKind::Package,
            name: package.source.clone(),
            description: None,
            path: package.root.filter(|_| !missing).as_deref().map(lossy),
            scope: scope(package.scope),
            source_kind: AgentResourceSourceKind::Setting,
            source: lossy(&package.settings_path),
            trust: trust(package.scope),
            status: if missing {
                AgentResourceStatus::Missing
            } else {
                AgentResourceStatus::Ready
            },
            winner: None,
            warnings: if missing {
                vec!["The package is not installed.".to_owned()]
            } else {
                Vec::new()
            },
        });
    }
    AgentResourceIndex {
        resources,
        warnings: warnings
            .into_iter()
            .map(|warning| AgentResourceWarning {
                path: lossy(&warning.path),
                message: warning.message,
            })
            .collect(),
        project_trust,
    }
}

fn scope(scope: PiResourceScope) -> AgentResourceScope {
    match scope {
        PiResourceScope::User => AgentResourceScope::User,
        PiResourceScope::Project => AgentResourceScope::Project,
    }
}

fn scope_key(scope: PiResourceScope) -> &'static str {
    match scope {
        PiResourceScope::User => "user",
        PiResourceScope::Project => "project",
    }
}

fn lossy(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}
