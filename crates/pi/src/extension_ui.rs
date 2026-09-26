use serde_json::{Value, json};
use std::error::Error;
use std::fmt;

/// A supported or explicitly unsupported request from Pi's extension UI protocol.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PiExtensionUiRequest {
    /// Ask the operator to choose one string from a list.
    Select {
        /// Request identifier used by the response.
        id: String,
        /// Dialog heading.
        title: String,
        /// Values offered by the extension.
        options: Vec<String>,
        /// Agent-side timeout in milliseconds, when configured.
        timeout: Option<u64>,
    },
    /// Ask the operator to confirm an action.
    Confirm {
        /// Request identifier used by the response.
        id: String,
        /// Dialog heading.
        title: String,
        /// Consequence or question shown below the heading.
        message: String,
        /// Agent-side timeout in milliseconds, when configured.
        timeout: Option<u64>,
    },
    /// Ask the operator for one line of text.
    Input {
        /// Request identifier used by the response.
        id: String,
        /// Dialog heading.
        title: String,
        /// Optional input hint.
        placeholder: Option<String>,
        /// Agent-side timeout in milliseconds, when configured.
        timeout: Option<u64>,
    },
    /// Ask the operator for multi-line text.
    Editor {
        /// Request identifier used by the response.
        id: String,
        /// Dialog heading.
        title: String,
        /// Initial editor content.
        prefill: Option<String>,
    },
    /// Show non-blocking extension feedback.
    Notification {
        /// Request identifier supplied by Pi.
        id: String,
        /// Notification text.
        message: String,
        /// Visual severity requested by the extension.
        level: PiExtensionNotificationLevel,
    },
    /// Set or clear one extension status entry.
    Status {
        /// Request identifier supplied by Pi.
        id: String,
        /// Stable extension-owned status key.
        key: String,
        /// New text, or `None` to clear the entry.
        text: Option<String>,
    },
    /// Set or clear one string-only extension widget.
    Widget {
        /// Request identifier supplied by Pi.
        id: String,
        /// Stable extension-owned widget key.
        key: String,
        /// New lines, or `None` to clear the widget.
        lines: Option<Vec<String>>,
        /// Requested position relative to the prompt editor.
        placement: PiExtensionWidgetPlacement,
    },
    /// A terminal-only or newer UI request that Pau cannot render.
    Unsupported {
        /// Request identifier supplied by Pi.
        id: String,
        /// Native method name retained for diagnostics and UI copy.
        method: String,
    },
}

/// Severity for an extension notification.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PiExtensionNotificationLevel {
    /// Informational feedback.
    Info,
    /// Feedback that needs attention but does not report failure.
    Warning,
    /// A failed extension operation.
    Error,
}

/// Position of a string widget around Pi's prompt editor.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PiExtensionWidgetPlacement {
    /// Before the editor.
    AboveEditor,
    /// After the editor.
    BelowEditor,
}

/// An operator response to a blocking extension UI request.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PiExtensionUiResponse {
    /// A selected, entered, or edited string.
    Value { id: String, value: String },
    /// A yes-or-no confirmation.
    Confirmed { id: String, confirmed: bool },
    /// A dismissed dialog.
    Cancelled { id: String },
}

impl PiExtensionUiResponse {
    pub(crate) fn into_record(self) -> Value {
        match self {
            Self::Value { id, value } => {
                json!({"type": "extension_ui_response", "id": id, "value": value})
            }
            Self::Confirmed { id, confirmed } => {
                json!({"type": "extension_ui_response", "id": id, "confirmed": confirmed})
            }
            Self::Cancelled { id } => {
                json!({"type": "extension_ui_response", "id": id, "cancelled": true})
            }
        }
    }
}

/// Why an extension UI protocol record could not be decoded.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiExtensionUiParseError {
    message: String,
}

impl fmt::Display for PiExtensionUiParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for PiExtensionUiParseError {}

impl TryFrom<&Value> for PiExtensionUiRequest {
    type Error = PiExtensionUiParseError;

    fn try_from(record: &Value) -> Result<Self, Self::Error> {
        if string(record, "type")? != "extension_ui_request" {
            return Err(parse_error("record is not an extension UI request"));
        }
        let id = string(record, "id")?.to_owned();
        let method = string(record, "method")?;
        let timeout = optional_u64(record, "timeout")?;

        match method {
            "select" => Ok(Self::Select {
                id,
                title: string(record, "title")?.to_owned(),
                options: string_array(record, "options")?,
                timeout,
            }),
            "confirm" => Ok(Self::Confirm {
                id,
                title: string(record, "title")?.to_owned(),
                message: string(record, "message")?.to_owned(),
                timeout,
            }),
            "input" => Ok(Self::Input {
                id,
                title: string(record, "title")?.to_owned(),
                placeholder: optional_string(record, "placeholder")?,
                timeout,
            }),
            "editor" => Ok(Self::Editor {
                id,
                title: string(record, "title")?.to_owned(),
                prefill: optional_string(record, "prefill")?,
            }),
            "notify" => Ok(Self::Notification {
                id,
                message: string(record, "message")?.to_owned(),
                level: match optional_string(record, "notifyType")?.as_deref() {
                    None | Some("info") => PiExtensionNotificationLevel::Info,
                    Some("warning") => PiExtensionNotificationLevel::Warning,
                    Some("error") => PiExtensionNotificationLevel::Error,
                    Some(_) => return Err(parse_error("notifyType has an unsupported value")),
                },
            }),
            "setStatus" => Ok(Self::Status {
                id,
                key: string(record, "statusKey")?.to_owned(),
                text: optional_string(record, "statusText")?,
            }),
            "setWidget" => Ok(Self::Widget {
                id,
                key: string(record, "widgetKey")?.to_owned(),
                lines: optional_string_array(record, "widgetLines")?,
                placement: match optional_string(record, "widgetPlacement")?.as_deref() {
                    None | Some("aboveEditor") => PiExtensionWidgetPlacement::AboveEditor,
                    Some("belowEditor") => PiExtensionWidgetPlacement::BelowEditor,
                    Some(_) => return Err(parse_error("widgetPlacement has an unsupported value")),
                },
            }),
            _ => Ok(Self::Unsupported {
                id,
                method: method.to_owned(),
            }),
        }
    }
}

fn string<'a>(record: &'a Value, field: &str) -> Result<&'a str, PiExtensionUiParseError> {
    record
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| parse_error(&format!("extension UI request needs a string {field}")))
}

fn optional_string(record: &Value, field: &str) -> Result<Option<String>, PiExtensionUiParseError> {
    match record.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(parse_error(&format!(
            "extension UI request {field} must be a string"
        ))),
    }
}

fn optional_u64(record: &Value, field: &str) -> Result<Option<u64>, PiExtensionUiParseError> {
    match record.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value.as_u64().map(Some).ok_or_else(|| {
            parse_error(&format!(
                "extension UI request {field} must be a non-negative integer"
            ))
        }),
    }
}

fn string_array(record: &Value, field: &str) -> Result<Vec<String>, PiExtensionUiParseError> {
    let values = record
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| parse_error(&format!("extension UI request needs an array {field}")))?;
    values
        .iter()
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                parse_error(&format!(
                    "extension UI request {field} must contain strings"
                ))
            })
        })
        .collect()
}

fn optional_string_array(
    record: &Value,
    field: &str,
) -> Result<Option<Vec<String>>, PiExtensionUiParseError> {
    match record.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => string_array(record, field).map(Some),
    }
}

fn parse_error(message: &str) -> PiExtensionUiParseError {
    PiExtensionUiParseError {
        message: message.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_supported_requests_and_preserves_unsupported_methods() {
        let cases = [
            (
                json!({"type":"extension_ui_request","id":"select","method":"select","title":"Choose","options":["One","Two"],"timeout":50}),
                PiExtensionUiRequest::Select {
                    id: "select".into(),
                    title: "Choose".into(),
                    options: vec!["One".into(), "Two".into()],
                    timeout: Some(50),
                },
            ),
            (
                json!({"type":"extension_ui_request","id":"confirm","method":"confirm","title":"Continue?","message":"This changes a file."}),
                PiExtensionUiRequest::Confirm {
                    id: "confirm".into(),
                    title: "Continue?".into(),
                    message: "This changes a file.".into(),
                    timeout: None,
                },
            ),
            (
                json!({"type":"extension_ui_request","id":"input","method":"input","title":"Name","placeholder":"value"}),
                PiExtensionUiRequest::Input {
                    id: "input".into(),
                    title: "Name".into(),
                    placeholder: Some("value".into()),
                    timeout: None,
                },
            ),
            (
                json!({"type":"extension_ui_request","id":"editor","method":"editor","title":"Edit","prefill":"one\ntwo"}),
                PiExtensionUiRequest::Editor {
                    id: "editor".into(),
                    title: "Edit".into(),
                    prefill: Some("one\ntwo".into()),
                },
            ),
            (
                json!({"type":"extension_ui_request","id":"notify","method":"notify","message":"Blocked","notifyType":"warning"}),
                PiExtensionUiRequest::Notification {
                    id: "notify".into(),
                    message: "Blocked".into(),
                    level: PiExtensionNotificationLevel::Warning,
                },
            ),
            (
                json!({"type":"extension_ui_request","id":"status","method":"setStatus","statusKey":"fixture"}),
                PiExtensionUiRequest::Status {
                    id: "status".into(),
                    key: "fixture".into(),
                    text: None,
                },
            ),
            (
                json!({"type":"extension_ui_request","id":"widget","method":"setWidget","widgetKey":"fixture","widgetLines":["one","two"],"widgetPlacement":"belowEditor"}),
                PiExtensionUiRequest::Widget {
                    id: "widget".into(),
                    key: "fixture".into(),
                    lines: Some(vec!["one".into(), "two".into()]),
                    placement: PiExtensionWidgetPlacement::BelowEditor,
                },
            ),
            (
                json!({"type":"extension_ui_request","id":"custom","method":"custom"}),
                PiExtensionUiRequest::Unsupported {
                    id: "custom".into(),
                    method: "custom".into(),
                },
            ),
        ];

        for (record, expected) in cases {
            assert_eq!(PiExtensionUiRequest::try_from(&record).unwrap(), expected);
        }
    }

    #[test]
    fn rejects_malformed_supported_requests() {
        let error = PiExtensionUiRequest::try_from(&json!({
            "type":"extension_ui_request",
            "id":"select",
            "method":"select",
            "title":"Choose",
            "options":[1]
        }))
        .unwrap_err();

        assert!(error.to_string().contains("options must contain strings"));
    }

    #[test]
    fn encodes_dialog_responses() {
        assert_eq!(
            PiExtensionUiResponse::Value {
                id: "one".into(),
                value: "Allow".into()
            }
            .into_record(),
            json!({"type":"extension_ui_response","id":"one","value":"Allow"})
        );
        assert_eq!(
            PiExtensionUiResponse::Confirmed {
                id: "two".into(),
                confirmed: false
            }
            .into_record(),
            json!({"type":"extension_ui_response","id":"two","confirmed":false})
        );
        assert_eq!(
            PiExtensionUiResponse::Cancelled { id: "three".into() }.into_record(),
            json!({"type":"extension_ui_response","id":"three","cancelled":true})
        );
    }
}
