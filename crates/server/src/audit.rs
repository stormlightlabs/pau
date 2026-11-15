//! Audit records for API requests, and the routes that read and export them.
//!
//! A route that changes a process, a file, or a sandbox setting opens a
//! [`PendingAudit`] before it does any work and finishes it with the route's
//! result. Recording happens after the work and cannot fail the request. A
//! request whose future is dropped first, such as when its client
//! disconnects, is recorded as cancelled.
//!
//! `GET /api/audit` returns the retained [`AuditRecord`] values, oldest first.
//! `POST /api/audit/export` writes them to a new file at the absolute path in
//! an [`AuditExportRequest`]. Both are redacted already: see
//! [`pau_core::audit::AuditLog::record`].

use std::path::{Path, PathBuf};

use axum::{Json, extract::State, http::StatusCode};
use pau_core::audit::{AuditActor, AuditEntry, AuditLog, AuditOperation, AuditRecord, AuditResult};
use serde::Deserialize;

use crate::{ApiError, ApiState, terminals::TerminalApiError};

/// An audited request that has not finished yet. Dropping it unfinished
/// records the request as cancelled.
pub(crate) struct PendingAudit {
    log: AuditLog,
    entry: Option<AuditEntry>,
}

impl PendingAudit {
    /// Opens an operator request that changes `target` in `workspace_id`.
    pub(crate) fn operator(
        log: &AuditLog,
        operation: AuditOperation,
        workspace_id: Option<String>,
        target: Option<String>,
    ) -> Self {
        Self {
            log: log.clone(),
            entry: Some(AuditEntry {
                workspace_id,
                target,
                ..AuditEntry::new(AuditActor::Operator, operation, AuditResult::Cancelled)
            }),
        }
    }

    /// Names the session the request acts on, once it is known.
    pub(crate) fn session(&mut self, session_id: impl Into<String>) {
        if let Some(entry) = &mut self.entry {
            entry.session_id = Some(session_id.into());
        }
    }

    /// Names the workspace the request acts on, once it is known.
    pub(crate) fn workspace(&mut self, workspace_id: impl Into<String>) {
        if let Some(entry) = &mut self.entry {
            entry.workspace_id = Some(workspace_id.into());
        }
    }

    /// Names what the request changes, once it is known.
    pub(crate) fn target(&mut self, target: impl Into<String>) {
        if let Some(entry) = &mut self.entry {
            entry.target = Some(target.into());
        }
    }

    /// Records the request's result with the exit code of a stopped process.
    pub(crate) fn finish_with_exit<T, E: AuditedError>(
        mut self,
        result: &Result<T, E>,
        exit_code: Option<i32>,
    ) {
        let Some(mut entry) = self.entry.take() else {
            return;
        };
        entry.exit_code = exit_code;
        match result {
            Ok(_) => entry.result = AuditResult::Succeeded,
            Err(error) => {
                let (status, code) = error.status_and_code();
                entry.result = refused_or_failed(status, code);
                entry.reason = Some(code.to_owned());
            }
        }
        self.log.record(entry);
    }

    /// Records the request's result.
    pub(crate) fn finish<T, E: AuditedError>(self, result: &Result<T, E>) {
        self.finish_with_exit(result, None);
    }
}

impl Drop for PendingAudit {
    fn drop(&mut self) {
        if let Some(entry) = self.entry.take() {
            self.log.record(entry);
        }
    }
}

/// Whether an error status means Pau refused the request before acting, or
/// acted and failed.
///
/// Client errors and `501` are refusals, with two exceptions: a program that
/// could not start, and a write the operating system refused. Other server
/// errors are failures.
fn refused_or_failed(status: StatusCode, code: &str) -> AuditResult {
    let refused = (status.is_client_error() || status == StatusCode::NOT_IMPLEMENTED)
        && !matches!(code, "terminal_start_failed" | "permission_denied");
    if refused {
        AuditResult::Denied
    } else {
        AuditResult::Failed
    }
}

/// An API error an audit record can classify.
pub(crate) trait AuditedError {
    /// The response status and stable error code.
    fn status_and_code(&self) -> (StatusCode, &'static str);
}

impl AuditedError for ApiError {
    fn status_and_code(&self) -> (StatusCode, &'static str) {
        let (status, code, _) = self.parts();
        (status, code)
    }
}

impl AuditedError for TerminalApiError {
    fn status_and_code(&self) -> (StatusCode, &'static str) {
        let (status, code, _) = self.parts();
        (status, code)
    }
}

/// The file name an export record names. The folder is left out, because it
/// usually names the operator's home directory.
pub(crate) fn export_target(destination: &Path) -> Option<String> {
    destination
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
}

/// Returns the retained audit records, oldest first.
pub(crate) async fn list_audit(
    State(state): State<ApiState>,
) -> Result<Json<Vec<AuditRecord>>, ApiError> {
    state
        .audit
        .list()
        .await
        .map(Json)
        .map_err(|error| ApiError::Audit(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

/// Body of `POST /api/audit/export`.
#[derive(Debug, Deserialize)]
pub(crate) struct AuditExportRequest {
    /// Absolute path of the new file. An existing file is never replaced.
    destination: PathBuf,
}

/// Writes the retained audit records to a new JSON file. A relative path, an
/// existing file, or a failed write is `400 audit_error`.
pub(crate) async fn export_audit(
    State(state): State<ApiState>,
    Json(request): Json<AuditExportRequest>,
) -> Result<StatusCode, ApiError> {
    let audit = PendingAudit::operator(
        &state.audit,
        AuditOperation::FileExport,
        None,
        export_target(&request.destination),
    );
    let result = if request.destination.is_absolute() {
        state
            .audit
            .export(&request.destination)
            .await
            .map(|()| StatusCode::NO_CONTENT)
            .map_err(|error| ApiError::Audit(StatusCode::BAD_REQUEST, error.to_string()))
    } else {
        Err(ApiError::Audit(
            StatusCode::BAD_REQUEST,
            "the export destination must be an absolute path".to_owned(),
        ))
    };
    audit.finish(&result);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_refusals_and_failures() {
        let cases = [
            (
                StatusCode::BAD_REQUEST,
                "invalid_sandbox",
                AuditResult::Denied,
            ),
            (StatusCode::FORBIDDEN, "sensitive_path", AuditResult::Denied),
            (StatusCode::CONFLICT, "file_changed", AuditResult::Denied),
            (
                StatusCode::NOT_IMPLEMENTED,
                "sandboxed_session_unsupported",
                AuditResult::Denied,
            ),
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                "terminal_start_failed",
                AuditResult::Failed,
            ),
            (
                StatusCode::FORBIDDEN,
                "permission_denied",
                AuditResult::Failed,
            ),
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "pi_unavailable",
                AuditResult::Failed,
            ),
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                AuditResult::Failed,
            ),
        ];
        for (status, code, expected) in cases {
            assert_eq!(refused_or_failed(status, code), expected, "{code}");
        }
    }
}
