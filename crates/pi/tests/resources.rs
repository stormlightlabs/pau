use std::fs;
use std::os::unix::fs::symlink;
use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use pau_pi::{
    DiscoverPiResourcesOptions, PiProjectTrust, PiResource, PiResourceIndex, PiResourceKind,
    PiResourceScope, PiResourceSource, discover_pi_resources,
};
use tempfile::TempDir;

struct Fixture {
    root: TempDir,
}

impl Fixture {
    fn new() -> Self {
        Self {
            root: tempfile::tempdir().unwrap(),
        }
    }

    fn path(&self, relative: &str) -> PathBuf {
        self.root.path().join(relative)
    }

    fn write(&self, relative: &str, text: &str) {
        let path = self.path(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn skill(&self, dir: &str, name: &str) {
        self.write(
            &format!("{dir}/SKILL.md"),
            &format!("---\nname: {name}\ndescription: Does {name}.\n---\nBody\n"),
        );
    }

    fn discover_in(&self, workspace: &str) -> PiResourceIndex {
        fs::create_dir_all(self.path(workspace)).unwrap();
        discover_pi_resources(&DiscoverPiResourcesOptions {
            home_directory: self.path("home"),
            agent_directory: self.path("home/.pi/agent"),
            workspace: self.path(workspace),
        })
    }

    fn discover(&self) -> PiResourceIndex {
        self.discover_in("work")
    }

    /// Saves Pi's trust decision for the `work` workspace.
    fn trust_work(&self, decision: bool) {
        fs::create_dir_all(self.path("work")).unwrap();
        let key = serde_json::to_string(&self.path("work").canonicalize().unwrap()).unwrap();
        self.write(
            "home/.pi/agent/trust.json",
            &format!("{{{key}: {decision}}}"),
        );
    }
}

fn find<'a>(index: &'a PiResourceIndex, kind: PiResourceKind, name: &str) -> &'a PiResource {
    index
        .resources
        .iter()
        .find(|r| r.kind == kind && r.name == name)
        .unwrap_or_else(|| panic!("missing {kind:?} {name}: {:#?}", index.resources))
}

fn names(index: &PiResourceIndex, kind: PiResourceKind) -> Vec<&str> {
    index
        .resources
        .iter()
        .filter(|r| r.kind == kind)
        .map(|r| r.name.as_str())
        .collect()
}

fn warned(index: &PiResourceIndex, path_suffix: &str, text: &str) -> bool {
    index
        .warnings
        .iter()
        .any(|w| w.path.to_string_lossy().ends_with(path_suffix) && w.message.contains(text))
}

#[test]
fn indexes_user_and_project_resources_of_every_kind() {
    let f = Fixture::new();
    f.skill("home/.pi/agent/skills/user-skill", "user-skill");
    f.skill("work/.pi/skills/project-skill", "project-skill");
    f.skill("home/.agents/skills/shared-user", "shared-user");
    f.skill("work/.agents/skills/shared-project", "shared-project");
    f.write("home/.pi/agent/extensions/hello.ts", "");
    f.write("work/.pi/extensions/multi/index.js", "");
    f.write(
        "home/.pi/agent/prompts/review.md",
        "---\ndescription: Review code\n---\nGo\n",
    );
    f.write("work/.pi/prompts/fix.md", "\nFix the bug\nmore\n");
    f.write("home/.pi/agent/themes/dusk.json", r#"{"name":"dusk"}"#);
    f.write("work/.pi/themes/dawn.json", r#"{"name":"dawn"}"#);

    let index = f.discover();

    assert!(index.warnings.is_empty(), "{:#?}", index.warnings);
    let user = find(&index, PiResourceKind::Skill, "user-skill");
    assert_eq!(user.scope, PiResourceScope::User);
    assert_eq!(user.description.as_deref(), Some("Does user-skill."));
    assert!(matches!(user.source, PiResourceSource::Directory { .. }));
    let scope = |kind, name| find(&index, kind, name).scope;
    assert_eq!(
        scope(PiResourceKind::Skill, "project-skill"),
        PiResourceScope::Project
    );
    assert_eq!(
        scope(PiResourceKind::Skill, "shared-user"),
        PiResourceScope::User
    );
    assert_eq!(
        scope(PiResourceKind::Skill, "shared-project"),
        PiResourceScope::Project
    );
    assert_eq!(
        scope(PiResourceKind::Extension, "hello"),
        PiResourceScope::User
    );
    assert_eq!(
        scope(PiResourceKind::Extension, "multi"),
        PiResourceScope::Project
    );
    assert_eq!(scope(PiResourceKind::Theme, "dusk"), PiResourceScope::User);
    assert_eq!(
        scope(PiResourceKind::Theme, "dawn"),
        PiResourceScope::Project
    );
    let description = |name| {
        find(&index, PiResourceKind::Prompt, name)
            .description
            .clone()
    };
    assert_eq!(description("review").as_deref(), Some("Review code"));
    assert_eq!(description("fix").as_deref(), Some("Fix the bug"));
}

#[test]
fn missing_locations_produce_an_empty_index() {
    assert_eq!(Fixture::new().discover(), PiResourceIndex::default());
}

#[test]
fn malformed_and_incomplete_resources_warn_without_hiding_others() {
    let f = Fixture::new();
    f.skill("work/.pi/skills/good", "good");
    f.write(
        "work/.pi/skills/unclosed/SKILL.md",
        "---\nname: unclosed\ndescription: x\n",
    );
    f.write("work/.pi/skills/bare/SKILL.md", "---\nname: bare\n---\n");
    f.write(
        "work/.pi/skills/Bad_Name/SKILL.md",
        "---\nname: Bad_Name\ndescription: d\n---\n",
    );
    f.write(
        "work/.pi/skills/nested/deep/SKILL.md",
        "---\ndescription: deep one\n---\n",
    );
    f.write(
        "work/.pi/skills/standalone.md",
        "---\ndescription: flat\n---\n",
    );
    f.write("work/.pi/themes/broken.json", "{ nope");
    f.write("work/.pi/themes/anonymous.json", "{}");
    f.write("work/.pi/settings.json", "[1]");
    f.trust_work(true);

    let index = f.discover();

    assert_eq!(
        names(&index, PiResourceKind::Skill),
        ["Bad_Name", "good", "deep", "standalone"]
    );
    assert!(warned(&index, "unclosed/SKILL.md", "Malformed frontmatter"));
    assert!(warned(&index, "bare/SKILL.md", "Missing description"));
    assert!(warned(&index, "Bad_Name/SKILL.md", "lowercase"));
    assert!(warned(&index, "broken.json", "not valid JSON"));
    assert!(warned(&index, "anonymous.json", "no name"));
    assert!(warned(
        &index,
        ".pi/settings.json",
        "not a valid JSON object"
    ));
    assert!(names(&index, PiResourceKind::Theme).is_empty());
    let skipped: Vec<_> = index
        .skipped
        .iter()
        .map(|s| (s.resource.name.as_str(), s.winner.is_none()))
        .collect();
    assert_eq!(
        skipped,
        [
            ("bare", true),
            ("unclosed", true),
            ("anonymous", true),
            ("broken", true)
        ]
    );
}

#[test]
fn duplicate_names_keep_the_first_discovery_and_warn() {
    let f = Fixture::new();
    f.skill("work/.pi/skills/same", "same");
    f.skill("home/.pi/agent/skills/same", "same");
    f.write("work/.pi/themes/a.json", r#"{"name":"t"}"#);
    f.write("home/.pi/agent/themes/b.json", r#"{"name":"t"}"#);
    f.write("work/.pi/extensions/dup.ts", "");
    f.write("home/.pi/agent/extensions/dup.ts", "");
    f.trust_work(true);

    let index = f.discover();

    let scope = |kind, name| find(&index, kind, name).scope;
    assert_eq!(
        scope(PiResourceKind::Skill, "same"),
        PiResourceScope::Project
    );
    assert_eq!(scope(PiResourceKind::Theme, "t"), PiResourceScope::Project);
    assert!(warned(&index, "agent/skills/same/SKILL.md", "collides"));
    assert!(warned(&index, "agent/themes/b.json", "collides"));
    // Extensions have no name uniqueness rule.
    assert_eq!(names(&index, PiResourceKind::Extension), ["dup", "dup"]);
    assert_eq!(index.warnings.len(), 2);
    let skipped = &index.skipped[0];
    assert_eq!(skipped.resource.scope, PiResourceScope::User);
    assert_eq!(
        skipped.winner.as_deref(),
        Some(f.path("work/.pi/skills/same/SKILL.md").as_path())
    );
    assert_eq!(index.skipped.len(), 2);
}

#[test]
fn reads_the_nearest_saved_trust_decision() {
    let f = Fixture::new();
    fs::create_dir_all(f.path("work/nested")).unwrap();
    let trust = |entries: &str| f.write("home/.pi/agent/trust.json", entries);
    let canonical = |relative: &str| f.path(relative).canonicalize().unwrap();
    let key = |relative: &str| serde_json::to_string(&canonical(relative)).unwrap();

    assert_eq!(f.discover().project_trust, PiProjectTrust::Undecided);
    trust(&format!("{{{}: true}}", key("work")));
    assert_eq!(
        f.discover_in("work/nested").project_trust,
        PiProjectTrust::Trusted
    );
    trust(&format!(
        "{{{}: true, {}: false}}",
        key("work"),
        key("work/nested")
    ));
    assert_eq!(
        f.discover_in("work/nested").project_trust,
        PiProjectTrust::Declined
    );
    trust("{}");
    f.write(
        "home/.pi/agent/settings.json",
        r#"{"defaultProjectTrust": "always"}"#,
    );
    assert_eq!(f.discover().project_trust, PiProjectTrust::Trusted);
    trust("[]");
    let index = f.discover();
    assert!(warned(&index, "trust.json", "not a valid JSON object"));
}

#[test]
fn follows_symlinks_and_reports_broken_or_looping_links() {
    let f = Fixture::new();
    f.skill("elsewhere/linked", "linked");
    fs::create_dir_all(f.path("work/.pi/skills")).unwrap();
    fs::create_dir_all(f.path("work/.pi/themes")).unwrap();
    symlink(f.path("elsewhere/linked"), f.path("work/.pi/skills/linked")).unwrap();
    symlink(f.path("nowhere"), f.path("work/.pi/skills/dangling")).unwrap();
    f.write("loop/inner/note.txt", "");
    symlink(f.path("loop"), f.path("loop/inner/back")).unwrap();
    symlink(f.path("loop"), f.path("work/.pi/skills/loop")).unwrap();
    f.write("elsewhere/theme.json", r#"{"name":"linked-theme"}"#);
    symlink(
        f.path("elsewhere/theme.json"),
        f.path("work/.pi/themes/t.json"),
    )
    .unwrap();

    let index = f.discover();

    assert_eq!(names(&index, PiResourceKind::Skill), ["linked"]);
    find(&index, PiResourceKind::Theme, "linked-theme");
    assert!(warned(&index, "skills/dangling", "Broken symbolic link"));
    assert!(warned(&index, "back", "loop"));
}

#[test]
fn settings_paths_resolve_by_scope_and_honor_exclusions() {
    let f = Fixture::new();
    f.skill("home/extra/one", "one");
    f.skill("work/.pi/team/two", "two");
    f.skill("work/.pi/team/three", "three");
    f.write(
        "work/.pi/settings.json",
        r#"{"skills":["team","!**/two"], "prompts":["missing"]}"#,
    );
    f.write(
        "home/.pi/agent/settings.json",
        r#"{
            // comments are allowed
            "skills": ["~/extra"],
            "extensions": ["ext/a.ts", "ext/b.ts", "-ext/b.ts"],
        }"#,
    );
    f.write("home/.pi/agent/ext/a.ts", "");
    f.write("home/.pi/agent/ext/b.ts", "");
    f.trust_work(true);

    let index = f.discover();

    let one = find(&index, PiResourceKind::Skill, "one");
    assert!(
        matches!(&one.source, PiResourceSource::Setting { settings_path }
        if settings_path.ends_with("agent/settings.json"))
    );
    assert_eq!(one.scope, PiResourceScope::User);
    assert_eq!(names(&index, PiResourceKind::Skill), ["three", "one"]);
    assert_eq!(names(&index, PiResourceKind::Extension), ["a"]);
    assert!(warned(&index, ".pi/missing", "does not exist"));
}

#[test]
fn indexes_packages_with_conventions_manifests_and_filters() {
    let f = Fixture::new();
    // Conventional layout, installed under the user npm directory.
    let npm = "home/.pi/agent/npm/node_modules/@acme/tools";
    f.write(&format!("{npm}/package.json"), r#"{"name":"@acme/tools"}"#);
    f.skill(&format!("{npm}/skills/pkg-skill"), "pkg-skill");
    f.write(&format!("{npm}/extensions/x.ts"), "");
    f.write(&format!("{npm}/extensions/legacy.ts"), "");
    f.write(&format!("{npm}/prompts/p.md"), "Prompt");
    // Manifest layout, local path relative to project settings.
    f.write(
        "work/.pi/local-pkg/package.json",
        r#"{"pi":{"themes":["./res/*.json","!./res/off.json"],"skills":["./s"]}}"#,
    );
    f.write("work/.pi/local-pkg/res/on.json", r#"{"name":"on"}"#);
    f.write("work/.pi/local-pkg/res/off.json", r#"{"name":"off"}"#);
    f.skill("work/.pi/local-pkg/s/manifest-skill", "manifest-skill");
    f.write(
        "home/.pi/agent/settings.json",
        r#"{"packages":[
            {"source":"npm:@acme/tools@1.0.0","extensions":["extensions/*.ts","!extensions/legacy.ts"],"prompts":[]},
            "npm:not-installed"
        ]}"#,
    );
    f.write("work/.pi/settings.json", r#"{"packages":["./local-pkg"]}"#);
    f.trust_work(true);

    let index = f.discover();

    assert_eq!(index.packages.len(), 3);
    let tools = index
        .packages
        .iter()
        .find(|p| p.source.starts_with("npm:@acme"))
        .unwrap();
    assert!(tools.installed);
    assert_eq!(tools.scope, PiResourceScope::User);
    let missing = index
        .packages
        .iter()
        .find(|p| p.source == "npm:not-installed")
        .unwrap();
    assert!(!missing.installed);

    assert_eq!(
        find(&index, PiResourceKind::Skill, "pkg-skill").source,
        PiResourceSource::Package {
            source: "npm:@acme/tools@1.0.0".into()
        }
    );
    assert_eq!(names(&index, PiResourceKind::Extension), ["x"]);
    assert!(names(&index, PiResourceKind::Prompt).is_empty());
    assert_eq!(names(&index, PiResourceKind::Theme), ["on"]);
    assert_eq!(
        find(&index, PiResourceKind::Skill, "manifest-skill").scope,
        PiResourceScope::Project
    );
}

#[test]
fn project_package_entry_replaces_the_user_entry() {
    let f = Fixture::new();
    f.write("home/.pi/agent/npm/node_modules/shared/package.json", "{}");
    f.write(
        "home/.pi/agent/npm/node_modules/shared/prompts/user.md",
        "u",
    );
    f.write("work/.pi/npm/node_modules/shared/package.json", "{}");
    f.write("work/.pi/npm/node_modules/shared/prompts/project.md", "p");
    f.write(
        "home/.pi/agent/settings.json",
        r#"{"packages":["npm:shared"]}"#,
    );
    f.write("work/.pi/settings.json", r#"{"packages":["npm:shared"]}"#);
    f.trust_work(true);

    let index = f.discover();

    assert_eq!(index.packages.len(), 1);
    assert_eq!(index.packages[0].scope, PiResourceScope::Project);
    assert_eq!(names(&index, PiResourceKind::Prompt), ["project"]);
}

/// Pi reads no project resource or project setting until the project is
/// trusted, so the user resources it loads win every collision, and the
/// project `settings.json` adds no paths or packages.
#[test]
fn untrusted_project_resources_never_shadow_user_ones() {
    for decision in [None, Some(false)] {
        let f = Fixture::new();
        f.write("work/.pi/prompts/review.md", "Project review\n");
        f.write("work/.pi/prompts/other.md", "Other\n");
        f.write("work/.pi/more/listed.md", "Listed\n");
        f.write(
            "work/.pi/settings.json",
            r#"{"prompts":["more"],"packages":["npm:shared"]}"#,
        );
        f.write("work/.pi/npm/node_modules/shared/package.json", "{}");
        f.write("work/.pi/npm/node_modules/shared/prompts/shared.md", "p");
        f.write("home/.pi/agent/prompts/review.md", "User review\n");
        f.write("home/.pi/agent/npm/node_modules/shared/package.json", "{}");
        f.write(
            "home/.pi/agent/npm/node_modules/shared/prompts/shared.md",
            "u",
        );
        f.write(
            "home/.pi/agent/settings.json",
            r#"{"packages":["npm:shared"]}"#,
        );
        if let Some(decision) = decision {
            f.trust_work(decision);
        }

        let index = f.discover();

        let ready = |name: &str| -> Vec<PiResourceScope> {
            index
                .resources
                .iter()
                .filter(|r| r.kind == PiResourceKind::Prompt && r.name == name)
                .map(|r| r.scope)
                .collect()
        };
        assert_eq!(
            ready("review"),
            [PiResourceScope::User, PiResourceScope::Project],
            "{decision:?}"
        );
        assert_eq!(ready("shared"), [PiResourceScope::User], "{decision:?}");
        assert!(ready("listed").is_empty(), "{decision:?}");
        let scopes: Vec<PiResourceScope> = index.packages.iter().map(|p| p.scope).collect();
        assert_eq!(scopes, [PiResourceScope::User]);
        assert!(index.skipped.is_empty(), "{:#?}", index.skipped);
    }
}

/// Runs discovery on another thread and fails instead of hanging when it
/// does not finish.
fn discover_within(f: &Fixture, seconds: u64) -> PiResourceIndex {
    let options = DiscoverPiResourcesOptions {
        home_directory: f.path("home"),
        agent_directory: f.path("home/.pi/agent"),
        workspace: f.path("work"),
    };
    fs::create_dir_all(&options.workspace).unwrap();
    let (send, receive) = mpsc::channel();
    thread::spawn(move || send.send(discover_pi_resources(&options)));
    receive
        .recv_timeout(Duration::from_secs(seconds))
        .expect("discovery did not finish")
}

#[test]
fn untrusted_settings_cannot_scan_outside_the_workspace() {
    let f = Fixture::new();
    f.skill("home/extra/outside", "outside");
    f.write("elsewhere/prompt.md", "Outside\n");
    f.write(
        "work/.pi/settings.json",
        r#"{"skills":["/","~"],"prompts":["~","../../elsewhere"],"themes":["/"]}"#,
    );
    f.write("work/.pi/prompts/inside.md", "Inside\n");

    let index = discover_within(&f, 10);

    let workspace = f.path("work");
    for resource in &index.resources {
        assert!(resource.path.starts_with(&workspace), "{resource:#?}");
    }
    assert_eq!(names(&index, PiResourceKind::Prompt), ["inside"]);
    assert!(names(&index, PiResourceKind::Skill).is_empty());
}

#[test]
fn skips_special_files_and_oversized_files() {
    let f = Fixture::new();
    f.write("work/.pi/prompts/ok.md", "Fine\n");
    let fifo = f.path("elsewhere/pipe.md");
    fs::create_dir_all(fifo.parent().unwrap()).unwrap();
    let made = Command::new("mkfifo").arg(&fifo).status().unwrap();
    assert!(made.success());
    symlink(&fifo, f.path("work/.pi/prompts/pipe.md")).unwrap();
    f.write("work/.pi/prompts/huge.md", &"x".repeat(600 * 1024));
    f.write(
        "work/.pi/settings.json",
        r#"{"prompts":["../../elsewhere/pipe.md"]}"#,
    );
    f.trust_work(true);

    let index = discover_within(&f, 10);

    assert_eq!(names(&index, PiResourceKind::Prompt), ["ok"]);
    assert!(warned(&index, "elsewhere/pipe.md", "Not a regular file"));
    assert!(warned(&index, "prompts/huge.md", "larger than 512 KiB"));
    assert!(
        index
            .skipped
            .iter()
            .any(|s| s.resource.path.ends_with("prompts/huge.md"))
    );
}

#[test]
fn folder_scans_stop_at_the_depth_and_entry_caps() {
    let f = Fixture::new();
    let deep = (0..12)
        .map(|i| format!("d{i}"))
        .collect::<Vec<_>>()
        .join("/");
    f.skill(&format!("work/.pi/skills/{deep}"), "deep");
    f.skill("work/.pi/skills/shallow", "shallow");
    let many = f.path("work/.pi/prompts");
    fs::create_dir_all(&many).unwrap();
    for i in 0..20_050 {
        fs::write(many.join(format!("{i:05}.txt")), "").unwrap();
    }
    f.trust_work(true);

    let index = discover_within(&f, 30);

    assert_eq!(names(&index, PiResourceKind::Skill), ["shallow"]);
    assert!(warned(&index, "d8", "nested too deeply"));
    assert!(warned(
        &index,
        ".pi/prompts",
        "Scan stopped after 20000 entries"
    ));
}

#[test]
fn ancestor_agents_skills_stop_at_the_repository_root() {
    let f = Fixture::new();
    f.write("repo/.git/HEAD", "");
    f.skill("repo/.agents/skills/repo-skill", "repo-skill");
    f.skill("repo/packages/.agents/skills/mid-skill", "mid-skill");
    f.skill(".agents/skills/above-root", "above-root");

    let index = f.discover_in("repo/packages/app");

    assert_eq!(
        names(&index, PiResourceKind::Skill),
        ["mid-skill", "repo-skill"]
    );
}
