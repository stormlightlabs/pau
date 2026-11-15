use std::{fs, path::PathBuf};

use axum::{
    body::{Body, to_bytes},
    extract::Request,
    http::{StatusCode, header},
};
use pau_core::{persistence::Database, workspace::WorkspaceService};
use pau_pi::{DiscoverPiOptions, PiSessionRegistry};
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;

use crate::{
    ApiServices, ApiToken, EventHub, default_diagnostics, router_with_services,
    sessions::SessionApi,
};

const TOKEN: &str = "0123456789abcdef0123456789abcdef";

/// A home directory, a `project` workspace inside it, and an API that serves
/// both.
struct Fixture {
    _directory: TempDir,
    /// The temporary directory's canonical path, which the workspace
    /// registry also records.
    root: PathBuf,
    workspace_id: String,
    app: axum::Router,
}

impl Fixture {
    async fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let project = root.join("project");
        fs::create_dir(&project).unwrap();
        let database = Database::open(":memory:").await.unwrap();
        let workspaces = WorkspaceService::new(database.workspaces());
        let workspace = workspaces.open(&project, None).await.unwrap();
        let events = EventHub::default();
        let sessions = SessionApi::new(
            PiSessionRegistry::new(database.processes()),
            DiscoverPiOptions {
                executable_path: None,
                path: crate::sessions::tests::FIXTURE_PATH.as_str().into(),
                home_directory: Some(root.clone()),
                agent_directory: None,
                session_directory: None,
                working_directory: root.clone(),
            },
            events.clone(),
            Default::default(),
        );
        let app = router_with_services(
            ApiToken::configured(TOKEN).unwrap(),
            events,
            default_diagnostics(),
            ApiServices {
                workspaces: Some(workspaces),
                sessions: Some(sessions),
                ..ApiServices::default()
            },
        );
        Self {
            _directory: directory,
            root,
            workspace_id: workspace.id,
            app,
        }
    }

    fn path(&self, relative: &str) -> String {
        self.root.join(relative).display().to_string()
    }

    fn write(&self, relative: &str, text: &str) {
        let path = self.root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn trust_project(&self, decision: bool) {
        self.write(
            ".pi/agent/trust.json",
            &json!({ self.path("project"): decision }).to_string(),
        );
    }

    async fn get(&self, workspace_id: &str) -> (StatusCode, Value) {
        let request = Request::builder()
            .uri(format!("/api/workspaces/{workspace_id}/resources"))
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
            .body(Body::empty())
            .unwrap();
        let response = self.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn index(&self) -> Value {
        let (status, index) = self.get(&self.workspace_id).await;
        assert_eq!(status, StatusCode::OK, "{index}");
        index
    }
}

fn resource<'a>(index: &'a Value, kind: &str, name: &str) -> &'a Value {
    index["resources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|resource| resource["kind"] == kind && resource["name"] == name)
        .unwrap_or_else(|| panic!("missing {kind} {name}: {index:#}"))
}

#[tokio::test]
async fn serves_user_project_setting_and_package_resources() {
    let f = Fixture::new().await;
    f.write(
        ".pi/agent/skills/user-skill/SKILL.md",
        "---\nname: user-skill\ndescription: Writes tests.\n---\n",
    );
    f.write(
        "extra/listed/SKILL.md",
        "---\nname: listed\ndescription: Listed in settings.\n---\n",
    );
    f.write(
        ".pi/agent/settings.json",
        r#"{"skills": ["~/extra"], "packages": ["npm:absent"]}"#,
    );
    f.write("project/.pi/prompts/fix.md", "Fix the failing test\n");
    f.write("project/.pi/settings.json", r#"{"packages": ["./pkg"]}"#);
    f.write("project/.pi/pkg/extensions/tool.ts", "");
    f.trust_project(true);

    let index = f.index().await;

    assert_eq!(index["project_trust"], "trusted");
    assert_eq!(index["warnings"], json!([]));
    assert_eq!(
        resource(&index, "skill", "user-skill"),
        &json!({
            "id": f.path(".pi/agent/skills/user-skill/SKILL.md"),
            "kind": "skill",
            "name": "user-skill",
            "description": "Writes tests.",
            "path": f.path(".pi/agent/skills/user-skill/SKILL.md"),
            "scope": "user",
            "source_kind": "directory",
            "source": f.path(".pi/agent/skills"),
            "trust": "trusted",
            "status": "ready",
            "winner": null,
            "warnings": [],
        })
    );
    let listed = resource(&index, "skill", "listed");
    assert_eq!(listed["source_kind"], "setting");
    assert_eq!(listed["source"], f.path(".pi/agent/settings.json"));
    let prompt = resource(&index, "prompt", "fix");
    assert_eq!(prompt["scope"], "project");
    assert_eq!(prompt["description"], "Fix the failing test");
    let tool = resource(&index, "extension", "tool");
    assert_eq!(tool["source_kind"], "package");
    assert_eq!(tool["source"], "./pkg");
    assert_eq!(tool["trust"], "trusted");

    let package = resource(&index, "package", "./pkg");
    assert_eq!(package["scope"], "project");
    assert_eq!(package["status"], "ready");
    assert_eq!(package["source"], f.path("project/.pi/settings.json"));
    assert_eq!(package["path"], f.path("project/.pi/pkg"));
    let absent = resource(&index, "package", "npm:absent");
    assert_eq!(absent["status"], "missing");
    assert_eq!(absent["path"], Value::Null);
    assert_eq!(absent["warnings"], json!(["The package is not installed."]));
}

#[tokio::test]
async fn lists_invalid_and_duplicate_resources_without_hiding_the_rest() {
    let f = Fixture::new().await;
    f.write("project/.pi/themes/broken.json", "{ nope");
    f.write("project/.pi/themes/dusk.json", r#"{"name": "dusk"}"#);
    f.write(
        "project/.pi/skills/Bad_Name/SKILL.md",
        "---\nname: Bad_Name\ndescription: Loads with a warning.\n---\n",
    );
    f.write("project/.pi/prompts/review.md", "Project review\n");
    f.write(".pi/agent/prompts/review.md", "User review\n");
    f.write(".pi/agent/settings.json", r#"{"prompts": ["~/gone"]}"#);
    f.trust_project(true);

    let index = f.index().await;

    let broken = resource(&index, "theme", "broken");
    assert_eq!(broken["status"], "invalid");
    assert_eq!(
        broken["warnings"],
        json!(["Theme is not valid JSON; not loaded."])
    );
    assert_eq!(resource(&index, "theme", "dusk")["status"], "ready");
    let bad_name = resource(&index, "skill", "Bad_Name");
    assert_eq!(bad_name["status"], "ready");
    assert_eq!(bad_name["warnings"].as_array().unwrap().len(), 1);

    let reviews: Vec<&Value> = index["resources"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|resource| resource["name"] == "review")
        .collect();
    assert_eq!(reviews.len(), 2);
    assert_eq!(reviews[0]["status"], "ready");
    assert_eq!(reviews[0]["scope"], "project");
    assert_eq!(reviews[1]["status"], "duplicate");
    assert_eq!(reviews[1]["scope"], "user");
    assert_eq!(
        reviews[1]["winner"],
        f.path("project/.pi/prompts/review.md")
    );
    assert_eq!(reviews[1]["warnings"].as_array().unwrap().len(), 1);

    assert_eq!(
        index["warnings"],
        json!([{"path": f.path("gone"), "message": "Path does not exist."}])
    );
}

#[tokio::test]
async fn project_resources_follow_the_saved_trust_decision() {
    let f = Fixture::new().await;
    f.write(".pi/agent/prompts/user.md", "User prompt\n");
    f.write("project/.pi/prompts/project.md", "Project prompt\n");

    let undecided = f.index().await;
    assert_eq!(undecided["project_trust"], "undecided");
    assert_eq!(
        resource(&undecided, "prompt", "project")["trust"],
        "undecided"
    );
    assert_eq!(resource(&undecided, "prompt", "user")["trust"], "trusted");

    f.trust_project(false);
    let declined = f.index().await;
    assert_eq!(declined["project_trust"], "untrusted");
    assert_eq!(
        resource(&declined, "prompt", "project")["trust"],
        "untrusted"
    );
    assert_eq!(resource(&declined, "prompt", "user")["trust"], "trusted");
}

#[tokio::test]
async fn an_untrusted_project_never_shadows_user_resources() {
    let f = Fixture::new().await;
    f.write("project/.pi/prompts/review.md", "Project review\n");
    f.write(".pi/agent/prompts/review.md", "User review\n");
    f.write(
        "project/.pi/settings.json",
        r#"{"packages": ["npm:shared"]}"#,
    );
    f.write(".pi/agent/settings.json", r#"{"packages": ["npm:shared"]}"#);

    for (decision, trust) in [(None, "undecided"), (Some(false), "untrusted")] {
        if let Some(decision) = decision {
            f.trust_project(decision);
        }
        let index = f.index().await;
        let reviews: Vec<(&Value, &Value, &Value)> = index["resources"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|resource| resource["name"] == "review")
            .map(|resource| (&resource["scope"], &resource["status"], &resource["trust"]))
            .collect();
        assert_eq!(
            reviews,
            [
                (&json!("user"), &json!("ready"), &json!("trusted")),
                (&json!("project"), &json!("ready"), &json!(trust)),
            ]
        );
        let packages: Vec<(&Value, &Value)> = index["resources"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|resource| resource["kind"] == "package")
            .map(|resource| (&resource["scope"], &resource["trust"]))
            .collect();
        // Pi reads no project settings until the project is trusted, so the
        // project's package entry is not listed.
        assert_eq!(packages, [(&json!("user"), &json!("trusted"))]);
    }
}

#[tokio::test]
async fn an_unknown_workspace_is_not_found() {
    let f = Fixture::new().await;
    let (status, _) = f.get("missing").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
