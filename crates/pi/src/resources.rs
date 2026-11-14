//! Index of Pi skills, extensions, prompt templates, themes, and packages.
//!
//! Locations and rules follow Pi's `configuration.md`, `skills.md`,
//! `themes.md`, `settings.md`, and `packages.md`. The indexer only reads the
//! filesystem. Problems that Pi would report as startup diagnostics become
//! [`PiResourceWarning`]s so one bad file never hides the rest.
//!
//! Lookup order, which decides duplicate winners (the first discovery wins).
//! It mirrors `resourcePrecedenceRank` in Pi's `dist/core/package-manager.js`
//! (`resolve` and `addAutoDiscoveredResources`):
//!
//! 1. Paths listed in project settings.
//! 2. Project directories: `.pi/<kind>/`, then `.agents/skills/` from the
//!    workspace up to the repository root (to the filesystem root when there is
//!    no repository), skipping `~/.agents/skills`.
//! 3. Paths listed in user settings.
//! 4. User directories: `<agent-dir>/<kind>/`, then `~/.agents/skills/`.
//! 5. Packages declared in project, then user, settings. A project entry for
//!    the same package replaces the user entry.
//!
//! Pi only loads project `.pi` resources, project `.agents/skills`, and
//! project settings once the project is trusted. This indexer always reads
//! the project folders so they stay inspectable, and reports the saved
//! decision as [`PiResourceIndex::project_trust`] for the caller to present.
//! Until the project is trusted, it ignores the project `settings.json`, as Pi
//! does, so a committed file cannot point the scan outside the workspace. The
//! user scope is indexed first and names collide only within one scope, so a
//! project file never shadows the user resource Pi loads.
//!
//! Every read is limited to regular files of at most [`MAX_FILE_BYTES`], and
//! folder scans stop at [`MAX_WALK_DEPTH`] and [`MAX_WALK_ENTRIES`].

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use globset::GlobBuilder;
use jsonc_parser::parse_to_serde_value;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::mcp::{PackageDeclaration, package_key, package_root};

/// Largest resource, settings or manifest file the indexer reads. Pi's
/// resources are small text files; the cap keeps a committed multi-gigabyte
/// file from exhausting server memory.
const MAX_FILE_BYTES: u64 = 512 * 1024;
/// Deepest folder `walk` enters below a scanned path, as in `list_files`.
const MAX_WALK_DEPTH: usize = 8;
/// Directory entries one index examines before scanning stops.
const MAX_WALK_ENTRIES: usize = 20_000;
const NOT_REGULAR: &str = "Not a regular file or folder; skipped.";

/// Reads a UTF-8 file of at most [`MAX_FILE_BYTES`]. The path must name a
/// regular file after following symbolic links: opening a FIFO blocks and a
/// device such as `/dev/zero` never reaches the end.
fn read_bounded(path: &Path) -> io::Result<String> {
    if !fs::metadata(path)?.is_file() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, NOT_REGULAR));
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        let message = format!("File is larger than {} KiB.", MAX_FILE_BYTES / 1024);
        return Err(io::Error::new(io::ErrorKind::InvalidData, message));
    }
    String::from_utf8(bytes).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

/// Kind of Pi resource.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PiResourceKind {
    /// Agent Skills directory or standalone Markdown skill.
    Skill,
    /// TypeScript or JavaScript extension.
    Extension,
    /// Markdown prompt template.
    Prompt,
    /// JSON theme.
    Theme,
}

impl PiResourceKind {
    const ALL: [Self; 4] = [Self::Skill, Self::Extension, Self::Prompt, Self::Theme];

    /// Directory and settings key used by Pi and by package conventions.
    fn directory(self) -> &'static str {
        match self {
            Self::Skill => "skills",
            Self::Extension => "extensions",
            Self::Prompt => "prompts",
            Self::Theme => "themes",
        }
    }
}

/// Whether a resource belongs to the user or the project.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PiResourceScope {
    /// Agent directory or home directory.
    User,
    /// Workspace `.pi` or `.agents` directory.
    Project,
}

/// How Pi finds a resource.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case", tag = "type")]
pub enum PiResourceSource {
    /// Conventional resource directory.
    Directory {
        /// Directory that was scanned.
        path: PathBuf,
    },
    /// Path listed in a settings file.
    #[serde(rename_all = "camelCase")]
    Setting {
        /// Settings file that lists the path.
        settings_path: PathBuf,
    },
    /// Resource contributed by a package.
    Package {
        /// Package source exactly as declared in settings.
        source: String,
    },
}

/// One indexed resource.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiResource {
    /// Resource kind.
    pub kind: PiResourceKind,
    /// Skill or theme name, prompt command name, or extension name.
    pub name: String,
    /// Skill or prompt description when the file declares one.
    pub description: Option<String>,
    /// Skill `SKILL.md`, or the resource file.
    pub path: PathBuf,
    /// User or project scope.
    pub scope: PiResourceScope,
    /// Where the resource came from.
    pub source: PiResourceSource,
}

/// One package declared in settings.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiPackage {
    /// Source exactly as declared.
    pub source: String,
    /// Scope of the settings file that wins for this package.
    pub scope: PiResourceScope,
    /// Settings file that declares the package.
    pub settings_path: PathBuf,
    /// Resolved package directory, when the source maps to one.
    pub root: Option<PathBuf>,
    /// Whether the package directory exists.
    pub installed: bool,
}

/// A resource Pi finds but does not load.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSkippedResource {
    /// The resource as far as it could be read. An invalid file is named
    /// after its file or skill directory and has no description.
    #[serde(flatten)]
    pub resource: PiResource,
    /// For a name collision, the path of the resource that loads instead.
    /// `None` when the file is invalid; its reason is in the warnings.
    pub winner: Option<PathBuf>,
}

/// Pi's project trust decision for a workspace.
///
/// An extension handling Pi's `project_trust` event and the `--approve` flag
/// can override it in a running Pi; neither is visible on disk.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PiProjectTrust {
    /// A saved decision trusts the workspace, or `defaultProjectTrust` is
    /// `"always"`.
    Trusted,
    /// A saved decision declines the workspace, or `defaultProjectTrust` is
    /// `"never"`.
    Declined,
    /// No decision applies. RPC sessions skip project resources until the
    /// operator saves one with Pi's `/trust`.
    #[default]
    Undecided,
}

/// Problem found while indexing.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiResourceWarning {
    /// Kind of the affected resource, when known.
    pub kind: Option<PiResourceKind>,
    /// File or directory the warning is about.
    pub path: PathBuf,
    /// Human-readable explanation.
    pub message: String,
}

/// Everything found for one workspace.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiResourceIndex {
    /// Resources in discovery order.
    pub resources: Vec<PiResource>,
    /// Declared packages.
    pub packages: Vec<PiPackage>,
    /// Resources found but not loaded: name collisions and invalid files.
    pub skipped: Vec<PiSkippedResource>,
    /// Discovery warnings.
    pub warnings: Vec<PiResourceWarning>,
    /// Whether Pi loads the project-scope resources.
    pub project_trust: PiProjectTrust,
}

/// Locations used for one discovery run.
#[derive(Clone, Debug)]
pub struct DiscoverPiResourcesOptions {
    /// User home; holds `~/.agents/skills`.
    pub home_directory: PathBuf,
    /// Pi agent directory, normally `~/.pi/agent`.
    pub agent_directory: PathBuf,
    /// Workspace root.
    pub workspace: PathBuf,
}

/// One settings file and the scope it carries.
struct SettingsFile {
    value: Option<Value>,
    /// Directory that relative resource paths resolve from.
    base: PathBuf,
    path: PathBuf,
    scope: PiResourceScope,
}

/// Indexes user and project Pi resources.
pub fn discover_pi_resources(options: &DiscoverPiResourcesOptions) -> PiResourceIndex {
    let mut indexer = Indexer::default();
    let user = indexer.settings_file(options.agent_directory.clone(), PiResourceScope::User);
    let trust = indexer.project_trust(options, user.value.as_ref());
    indexer.index.project_trust = trust;
    let project_base = options.workspace.join(".pi");

    if trust == PiProjectTrust::Trusted {
        let project = indexer.settings_file(project_base, PiResourceScope::Project);
        let files = [project, user];
        scan_scope(&mut indexer, &files[0], options);
        scan_scope(&mut indexer, &files[1], options);
        indexer.scan_packages(&files);
    } else {
        // Pi reads no project settings until the project is trusted, so a
        // committed `settings.json` cannot point the scan outside the
        // workspace. The project folders are still listed for inspection.
        let project = SettingsFile {
            value: None,
            path: project_base.join("settings.json"),
            base: project_base,
            scope: PiResourceScope::Project,
        };
        // Scanning the user scope first lets a project file never shadow a
        // user one.
        indexer.isolate_scopes = true;
        scan_scope(&mut indexer, &user, options);
        indexer.scan_packages(std::slice::from_ref(&user));
        scan_scope(&mut indexer, &project, options);
    }
    indexer.index
}

/// Scans the paths one settings file lists, then its scope's conventional
/// directories.
fn scan_scope(indexer: &mut Indexer, file: &SettingsFile, options: &DiscoverPiResourcesOptions) {
    let home = &options.home_directory;
    indexer.scan_setting_paths(file, home);
    for kind in PiResourceKind::ALL {
        indexer.scan_directory(kind, &file.base.join(kind.directory()), file.scope);
        if kind == PiResourceKind::Skill && file.scope == PiResourceScope::Project {
            for root in project_agent_roots(&options.workspace, home) {
                indexer.scan_directory(kind, &root.join(".agents/skills"), file.scope);
            }
        }
    }
    if file.scope == PiResourceScope::User {
        indexer.scan_directory(
            PiResourceKind::Skill,
            &home.join(".agents/skills"),
            file.scope,
        );
    }
}

/// Directories whose `.agents/skills` Pi reads for the project: the workspace
/// and its ancestors up to the repository root. The home directory's own
/// `.agents/skills` is a user location and is left out.
fn project_agent_roots(workspace: &Path, home: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for ancestor in workspace.ancestors() {
        if ancestor != home {
            roots.push(ancestor.to_path_buf());
        }
        if ancestor.join(".git").exists() {
            break;
        }
    }
    roots
}

#[derive(Default)]
struct Indexer {
    index: PiResourceIndex,
    seen_paths: HashSet<PathBuf>,
    /// Directory entries `walk` has examined across the whole index.
    walked_entries: usize,
    /// Set once the entry budget runs out, so the warning appears once.
    walk_stopped: bool,
    /// Set when the project is not trusted: names then collide only within
    /// one scope, since Pi loads no project resource that could win.
    isolate_scopes: bool,
}

impl Indexer {
    /// Counts one directory entry under `dir`. Returns true once the budget
    /// is spent, warning the first time.
    fn walk_budget_spent(&mut self, kind: PiResourceKind, dir: &Path) -> bool {
        self.walked_entries += 1;
        if self.walked_entries <= MAX_WALK_ENTRIES {
            return false;
        }
        if !self.walk_stopped {
            self.walk_stopped = true;
            let message = format!("Scan stopped after {MAX_WALK_ENTRIES} entries.");
            self.warn(Some(kind), dir, message);
        }
        true
    }

    fn warn(&mut self, kind: Option<PiResourceKind>, path: &Path, message: impl Into<String>) {
        self.index.warnings.push(PiResourceWarning {
            kind,
            path: path.to_path_buf(),
            message: message.into(),
        });
    }

    /// Scans a conventional directory. A missing one is normal and silent.
    fn scan_directory(&mut self, kind: PiResourceKind, path: &Path, scope: PiResourceScope) {
        let source = PiResourceSource::Directory {
            path: path.to_path_buf(),
        };
        for candidate in self.collect(kind, path, true).unwrap_or_default() {
            self.add(candidate, scope, source.clone());
        }
    }

    /// Returns candidates at `path` (a file or a directory), or `None` when it
    /// is absent or unusable. Absent paths warn unless `quiet_missing`.
    fn collect(
        &mut self,
        kind: PiResourceKind,
        path: &Path,
        quiet_missing: bool,
    ) -> Option<Vec<Candidate>> {
        // `metadata` follows symlinks, so a dangling link errors here.
        let Ok(meta) = fs::metadata(path) else {
            if fs::symlink_metadata(path).is_ok() {
                self.warn(Some(kind), path, "Broken symbolic link.");
            } else if !quiet_missing {
                self.warn(Some(kind), path, "Path does not exist.");
            }
            return None;
        };
        let mut found = Vec::new();
        if meta.is_file() {
            self.candidate_file(kind, path, &mut found, true);
        } else if meta.is_dir() {
            self.walk(kind, path, &mut found, &mut HashSet::new(), 0);
        } else {
            self.warn(Some(kind), path, NOT_REGULAR);
            return None;
        }
        Some(found)
    }

    /// Collects candidates under `dir`, `depth` levels below the scanned path.
    /// Depth and the indexer's entry budget bound the scan, since a settings
    /// path or a symbolic link can point at a large tree.
    fn walk(
        &mut self,
        kind: PiResourceKind,
        dir: &Path,
        found: &mut Vec<Candidate>,
        visited: &mut HashSet<PathBuf>,
        depth: usize,
    ) {
        if depth > MAX_WALK_DEPTH {
            self.warn(Some(kind), dir, "Folder is nested too deeply; not scanned.");
            return;
        }
        let Ok(canonical) = fs::canonicalize(dir) else {
            return;
        };
        if !visited.insert(canonical) {
            self.warn(Some(kind), dir, "Symbolic link loop skipped.");
            return;
        }
        // A skill directory ends the recursion; its other files are support.
        let skill_file = dir.join("SKILL.md");
        if kind == PiResourceKind::Skill && skill_file.is_file() {
            found.push(Candidate::new(kind, skill_file));
            return;
        }
        let mut entries: Vec<PathBuf> = match fs::read_dir(dir) {
            Ok(read) => read.flatten().map(|entry| entry.path()).collect(),
            Err(error) => {
                self.warn(Some(kind), dir, format!("Cannot read directory: {error}"));
                return;
            }
        };
        entries.sort();
        for entry in entries {
            let name = entry.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            if self.walk_budget_spent(kind, dir) {
                return;
            }
            let Ok(meta) = fs::metadata(&entry) else {
                self.warn(Some(kind), &entry, "Broken symbolic link.");
                continue;
            };
            if meta.is_dir() {
                match kind {
                    PiResourceKind::Skill => self.walk(kind, &entry, found, visited, depth + 1),
                    PiResourceKind::Extension => {
                        let index = ["index.ts", "index.js"]
                            .iter()
                            .map(|file| entry.join(file))
                            .find(|file| file.is_file());
                        if let Some(index) = index {
                            found.push(Candidate::new(kind, index));
                        }
                    }
                    PiResourceKind::Prompt | PiResourceKind::Theme => {}
                }
            } else if !meta.is_file() {
                // Devices, FIFOs and sockets never finish reading.
                continue;
            } else if depth == 0 || kind != PiResourceKind::Skill {
                // Standalone Markdown skills count only at the top level.
                self.candidate_file(kind, &entry, found, false);
            }
        }
    }

    /// Adds `file` when its extension suits `kind`. Files named directly by a
    /// setting or manifest (`explicit`) warn when they do not.
    fn candidate_file(
        &mut self,
        kind: PiResourceKind,
        file: &Path,
        found: &mut Vec<Candidate>,
        explicit: bool,
    ) {
        let extension = file.extension().and_then(|e| e.to_str()).unwrap_or("");
        let suits = match kind {
            PiResourceKind::Skill | PiResourceKind::Prompt => extension == "md",
            PiResourceKind::Extension => matches!(extension, "ts" | "js"),
            PiResourceKind::Theme => extension == "json",
        };
        if suits {
            found.push(Candidate::new(kind, file.to_path_buf()));
        } else if explicit {
            self.warn(
                Some(kind),
                file,
                "File type does not match the resource kind.",
            );
        }
    }

    /// Reads, validates, and records one candidate.
    fn add(&mut self, candidate: Candidate, scope: PiResourceScope, source: PiResourceSource) {
        let canonical = fs::canonicalize(&candidate.file).unwrap_or(candidate.file.clone());
        if !self.seen_paths.insert(canonical) {
            return;
        }
        let kind = candidate.kind;
        let loaded = match kind {
            PiResourceKind::Skill => self.load_skill(&candidate),
            PiResourceKind::Prompt => self.load_prompt(&candidate),
            PiResourceKind::Theme => self.load_theme(&candidate),
            PiResourceKind::Extension => Some((extension_name(&candidate), None)),
        };
        let Some((name, description)) = loaded else {
            let name = candidate.fallback_name();
            self.skip(candidate, name, None, scope, source, None);
            return;
        };
        // Skills, prompts, and themes need unique names; extensions do not.
        if kind != PiResourceKind::Extension {
            let first = self
                .index
                .resources
                .iter()
                .find(|r| {
                    r.kind == kind && r.name == name && (!self.isolate_scopes || r.scope == scope)
                })
                .map(|r| r.path.clone());
            if let Some(first) = first {
                let message = format!(
                    "Name \"{name}\" collides with {}; keeping the first.",
                    first.display()
                );
                self.warn(Some(kind), &candidate.file, message);
                self.skip(candidate, name, description, scope, source, Some(first));
                return;
            }
        }
        self.index.resources.push(PiResource {
            kind,
            name,
            description,
            path: candidate.file,
            scope,
            source,
        });
    }

    fn skip(
        &mut self,
        candidate: Candidate,
        name: String,
        description: Option<String>,
        scope: PiResourceScope,
        source: PiResourceSource,
        winner: Option<PathBuf>,
    ) {
        self.index.skipped.push(PiSkippedResource {
            resource: PiResource {
                kind: candidate.kind,
                name,
                description,
                path: candidate.file,
                scope,
                source,
            },
            winner,
        });
    }

    /// Reads Pi's saved decision for the workspace from `trust.json` in the
    /// agent directory: the entry for the workspace or its nearest ancestor,
    /// by canonical path. Without one, the user setting `defaultProjectTrust`
    /// decides.
    fn project_trust(
        &mut self,
        options: &DiscoverPiResourcesOptions,
        user_settings: Option<&Value>,
    ) -> PiProjectTrust {
        let path = options.agent_directory.join("trust.json");
        let saved = match read_bounded(&path) {
            Ok(text) => match parse_json(&text) {
                Some(Value::Object(saved)) => saved,
                _ => {
                    self.warn(
                        None,
                        &path,
                        "Trust store is not a valid JSON object; ignored.",
                    );
                    Map::new()
                }
            },
            Err(_) => Map::new(),
        };
        let workspace = fs::canonicalize(&options.workspace).unwrap_or(options.workspace.clone());
        let decision = workspace.ancestors().find_map(|directory| {
            saved
                .get(directory.to_string_lossy().as_ref())
                .and_then(Value::as_bool)
        });
        let default = user_settings
            .and_then(|settings| settings.get("defaultProjectTrust"))
            .and_then(Value::as_str);
        match (decision, default) {
            (Some(true), _) | (None, Some("always")) => PiProjectTrust::Trusted,
            (Some(false), _) | (None, Some("never")) => PiProjectTrust::Declined,
            _ => PiProjectTrust::Undecided,
        }
    }

    fn load_skill(&mut self, c: &Candidate) -> Option<(String, Option<String>)> {
        let text = self.read(c)?;
        let Some(front) = parse_frontmatter(&text) else {
            self.warn(
                Some(c.kind),
                &c.file,
                "Malformed frontmatter; skill not loaded.",
            );
            return None;
        };
        let name = front
            .get("name")
            .cloned()
            .unwrap_or_else(|| c.fallback_name());
        let Some(description) = front.get("description").filter(|d| !d.trim().is_empty()) else {
            self.warn(
                Some(c.kind),
                &c.file,
                "Missing description; skill not loaded.",
            );
            return None;
        };
        if let Some(problem) = skill_name_problem(&name) {
            self.warn(
                Some(c.kind),
                &c.file,
                format!("Skill name \"{name}\" {problem}."),
            );
        }
        if description.chars().count() > 1024 {
            self.warn(
                Some(c.kind),
                &c.file,
                "Description exceeds 1024 characters.",
            );
        }
        Some((name, Some(description.clone())))
    }

    fn load_prompt(&mut self, c: &Candidate) -> Option<(String, Option<String>)> {
        let text = self.read(c)?;
        let description = parse_frontmatter(&text)
            .and_then(|front| front.get("description").cloned())
            .or_else(|| {
                strip_frontmatter(&text)
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .map(|line| line.trim().to_owned())
            });
        let name = c.file.file_stem()?.to_string_lossy().into_owned();
        Some((name, description))
    }

    fn load_theme(&mut self, c: &Candidate) -> Option<(String, Option<String>)> {
        let text = self.read(c)?;
        let value = match parse_json(&text) {
            Some(value) => value,
            None => {
                self.warn(
                    Some(c.kind),
                    &c.file,
                    "Theme is not valid JSON; not loaded.",
                );
                return None;
            }
        };
        let Some(name) = value.get("name").and_then(Value::as_str) else {
            self.warn(Some(c.kind), &c.file, "Theme has no name; not loaded.");
            return None;
        };
        Some((name.to_owned(), None))
    }

    fn read(&mut self, c: &Candidate) -> Option<String> {
        match read_bounded(&c.file) {
            Ok(text) => Some(text),
            Err(error) => {
                self.warn(Some(c.kind), &c.file, format!("Cannot read file: {error}"));
                None
            }
        }
    }

    /// Reads the `settings.json` in `base`.
    fn settings_file(&mut self, base: PathBuf, scope: PiResourceScope) -> SettingsFile {
        let path = base.join("settings.json");
        SettingsFile {
            value: self.read_settings(&path),
            base,
            path,
            scope,
        }
    }

    /// Reads a settings file. Absent is normal; unreadable JSON warns.
    fn read_settings(&mut self, path: &Path) -> Option<Value> {
        let text = match read_bounded(path) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return None,
            Err(error) => {
                self.warn(None, path, format!("Cannot read settings: {error}"));
                return None;
            }
        };
        match parse_json(&text) {
            Some(value) if value.is_object() => Some(value),
            _ => {
                self.warn(
                    None,
                    path,
                    "Settings file is not a valid JSON object; ignored.",
                );
                None
            }
        }
    }

    /// Handles the `skills`, `extensions`, `prompts`, and `themes` settings.
    /// Entries resolve from the settings base; `!pattern` and `-path` exclude,
    /// `+path` and plain entries include.
    fn scan_setting_paths(&mut self, file: &SettingsFile, home: &Path) {
        let Some(settings) = &file.value else { return };
        for kind in PiResourceKind::ALL {
            let Some(entries) = settings.get(kind.directory()).and_then(Value::as_array) else {
                continue;
            };
            let entries: Vec<&str> = entries.iter().filter_map(Value::as_str).collect();
            let filter = Filter::new(&entries, false);
            for entry in entries.iter().filter(|e| !e.starts_with(['!', '-'])) {
                let path = resolve_path(entry.strip_prefix('+').unwrap_or(entry), &file.base, home);
                for candidate in self.collect(kind, &path, false).unwrap_or_default() {
                    if filter.excludes(&candidate.unit(), &file.base, home) {
                        continue;
                    }
                    let source = PiResourceSource::Setting {
                        settings_path: file.path.clone(),
                    };
                    self.add(candidate, file.scope, source);
                }
            }
        }
    }

    fn scan_packages(&mut self, files: &[SettingsFile]) {
        // When `files` holds both scopes, project comes first, so a user entry
        // for the same package is dropped.
        let mut seen = HashSet::new();
        for file in files {
            let Some(entries) = file
                .value
                .as_ref()
                .and_then(|v| v.get("packages"))
                .and_then(Value::as_array)
            else {
                continue;
            };
            for entry in entries {
                let (source, filters) = match entry {
                    Value::String(source) => (source.as_str(), None),
                    Value::Object(object) => match object.get("source").and_then(Value::as_str) {
                        Some(source) => (source, Some(object)),
                        None => {
                            self.warn(None, &file.path, "Package entry has no source.");
                            continue;
                        }
                    },
                    _ => {
                        self.warn(None, &file.path, "Package entry is not a string or object.");
                        continue;
                    }
                };
                if !seen.insert(package_key(source, &file.base)) {
                    continue;
                }
                let declaration = PackageDeclaration {
                    source: source.to_owned(),
                    settings_path: file.path.clone(),
                    extensions: None,
                };
                // Collecting the components drops the `.` of a `./pkg` source.
                let declared_root =
                    package_root(&declaration).map(|root| root.components().collect::<PathBuf>());
                let root = declared_root.clone().filter(|root| root.is_dir());
                self.index.packages.push(PiPackage {
                    source: source.to_owned(),
                    scope: file.scope,
                    settings_path: file.path.clone(),
                    root: declared_root,
                    installed: root.is_some(),
                });
                // A missing package is reported by `PiPackage::installed`.
                if let Some(root) = root {
                    self.scan_package(&root, source, filters, file.scope);
                }
            }
        }
    }

    /// Indexes a package from its `pi` manifest, or from the conventional
    /// directories when it has none, then applies the settings filters.
    fn scan_package(
        &mut self,
        root: &Path,
        source: &str,
        filters: Option<&Map<String, Value>>,
        scope: PiResourceScope,
    ) {
        let manifest = read_bounded(&root.join("package.json"))
            .ok()
            .and_then(|text| parse_json(&text))
            .and_then(|value| value.get("pi").cloned());
        let origin = PiResourceSource::Package {
            source: source.to_owned(),
        };
        for kind in PiResourceKind::ALL {
            let key = kind.directory();
            let paths = match manifest.as_ref().and_then(|m| m.get(key)) {
                Some(Value::Array(items)) => expand_manifest(
                    root,
                    &items.iter().filter_map(Value::as_str).collect::<Vec<_>>(),
                ),
                Some(_) => Vec::new(),
                None => vec![root.join(key)],
            };
            let selection = filters.and_then(|f| f.get(key)).and_then(Value::as_array);
            let entries: Vec<&str> = selection
                .map(|a| a.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            // `[]` loads none of this kind; an absent property loads all.
            if selection.is_some_and(|a| a.is_empty()) {
                continue;
            }
            let filter = Filter::new(&entries, true);
            for path in paths {
                for candidate in self.collect(kind, &path, true).unwrap_or_default() {
                    if !filter.excludes(&candidate.unit(), root, root) {
                        self.add(candidate, scope, origin.clone());
                    }
                }
            }
        }
    }
}

/// A resource that has been located but not yet read.
struct Candidate {
    kind: PiResourceKind,
    /// File that is read and reported as the resource path.
    file: PathBuf,
}

impl Candidate {
    fn new(kind: PiResourceKind, file: PathBuf) -> Self {
        Self { kind, file }
    }

    /// Name for a file that could not be read: the skill directory, or the
    /// file name without its extension.
    fn fallback_name(&self) -> String {
        let name = if self.is_skill_directory() {
            self.file.parent().and_then(Path::file_name)
        } else {
            self.file.file_stem()
        };
        name.map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    fn is_skill_directory(&self) -> bool {
        self.kind == PiResourceKind::Skill && self.file.file_name().is_some_and(|n| n == "SKILL.md")
    }

    /// What filters match against: the skill or extension directory when the
    /// resource has one, otherwise the file.
    fn unit(&self) -> PathBuf {
        let directory_entry = self.is_skill_directory()
            || self.file.file_stem().is_some_and(|stem| stem == "index")
                && self.kind == PiResourceKind::Extension;
        match self.file.parent() {
            Some(parent) if directory_entry => parent.to_path_buf(),
            _ => self.file.clone(),
        }
    }
}

fn extension_name(candidate: &Candidate) -> String {
    let unit = candidate.unit();
    let name = if unit == candidate.file {
        unit.file_stem()
    } else {
        unit.file_name()
    };
    name.map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Agent Skills naming: lowercase letters, digits, single interior hyphens,
/// at most 64 characters.
fn skill_name_problem(name: &str) -> Option<&'static str> {
    if name.is_empty() || name.chars().count() > 64 {
        Some("must be 1 to 64 characters")
    } else if !name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        Some("may only use lowercase letters, numbers, and hyphens")
    } else if name.starts_with('-') || name.ends_with('-') || name.contains("--") {
        Some("must not start, end, or repeat hyphens")
    } else {
        None
    }
}

fn resolve_path(entry: &str, base: &Path, home: &Path) -> PathBuf {
    if let Some(rest) = entry.strip_prefix("~/") {
        return home.join(rest);
    }
    let path = Path::new(entry);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    }
}

/// Include and exclude rules from a settings or package filter array.
struct Filter {
    /// Plain entries. For packages they narrow what loads.
    allow: Vec<String>,
    /// `+path`: exact inclusion that beats every exclusion.
    force: Vec<String>,
    /// `!pattern`: glob exclusion.
    deny_globs: Vec<String>,
    /// `-path`: exact exclusion.
    deny_exact: Vec<String>,
    narrowing: bool,
}

impl Filter {
    fn new(entries: &[&str], narrowing: bool) -> Self {
        let mut filter = Self {
            allow: Vec::new(),
            force: Vec::new(),
            deny_globs: Vec::new(),
            deny_exact: Vec::new(),
            narrowing,
        };
        for entry in entries {
            if let Some(p) = entry.strip_prefix('!') {
                filter.deny_globs.push(p.to_owned());
            } else if let Some(p) = entry.strip_prefix('-') {
                filter.deny_exact.push(p.to_owned());
            } else if let Some(p) = entry.strip_prefix('+') {
                filter.force.push(p.to_owned());
            } else {
                filter.allow.push((*entry).to_owned());
            }
        }
        filter
    }

    /// True when `unit` is filtered out. Patterns match the path relative to
    /// `base`, or the resolved absolute path.
    fn excludes(&self, unit: &Path, base: &Path, home: &Path) -> bool {
        let relative = unit.strip_prefix(base).unwrap_or(unit);
        let relative = relative.to_string_lossy().replace('\\', "/");
        let exact = |pattern: &str| {
            let pattern = pattern.trim_start_matches("./");
            pattern == relative || resolve_path(pattern, base, home) == unit
        };
        let glob = |pattern: &str| {
            let pattern = pattern.trim_start_matches("./");
            glob_match(pattern, &relative)
                || glob_match(
                    &resolve_path(pattern, base, home).to_string_lossy(),
                    &unit.to_string_lossy(),
                )
        };
        if self.force.iter().any(|p| exact(p)) {
            return false;
        }
        if self.deny_exact.iter().any(|p| exact(p)) || self.deny_globs.iter().any(|p| glob(p)) {
            return true;
        }
        self.narrowing && !self.allow.is_empty() && !self.allow.iter().any(|p| glob(p))
    }
}

/// Expands a package manifest array into existing paths, applying `!`
/// exclusions. `*` and `**` globs are supported.
fn expand_manifest(root: &Path, items: &[&str]) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();
    for item in items.iter().filter(|i| !i.starts_with('!')) {
        let item = item.trim_start_matches("./");
        if !item.contains('*') {
            paths.push(root.join(item));
            continue;
        }
        let prefix: Vec<&str> = item.split('/').take_while(|s| !s.contains('*')).collect();
        let mut files = Vec::new();
        list_files(&root.join(prefix.join("/")), &mut files, 0);
        for file in files {
            let relative = file.strip_prefix(root).unwrap_or(&file);
            if glob_match(item, &relative.to_string_lossy().replace('\\', "/")) {
                paths.push(file);
            }
        }
    }
    let denied: Vec<&str> = items
        .iter()
        .filter_map(|i| i.strip_prefix('!'))
        .map(|p| p.trim_start_matches("./"))
        .collect();
    paths.retain(|path| {
        let relative = path.strip_prefix(root).unwrap_or(path);
        let relative = relative.to_string_lossy().replace('\\', "/");
        !denied.iter().any(|pattern| glob_match(pattern, &relative))
    });
    paths
}

fn list_files(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 8 {
        return;
    }
    let Ok(read) = fs::read_dir(dir) else { return };
    let mut entries: Vec<PathBuf> = read.flatten().map(|e| e.path()).collect();
    entries.sort();
    for entry in entries {
        let name = entry.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        match fs::metadata(&entry) {
            Ok(meta) if meta.is_dir() => list_files(&entry, out, depth + 1),
            Ok(_) => out.push(entry),
            Err(_) => {}
        }
    }
}

/// Matches `text` against a glob where `*` stays within a path segment and
/// `**` crosses segments. An invalid pattern matches nothing.
fn glob_match(pattern: &str, text: &str) -> bool {
    GlobBuilder::new(pattern)
        .literal_separator(true)
        .build()
        .is_ok_and(|glob| glob.compile_matcher().is_match(text))
}

fn parse_json(text: &str) -> Option<Value> {
    parse_to_serde_value::<Option<Value>>(text, &Default::default())
        .ok()
        .flatten()
}

/// Parses the `---` block at the top of a Markdown file into flat key/value
/// pairs. Returns `None` when the block is present but malformed (no closing
/// fence, or a line that is neither `key: value` nor an indented
/// continuation). A file without frontmatter yields an empty map.
fn parse_frontmatter(text: &str) -> Option<HashMap<String, String>> {
    let mut map = HashMap::new();
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return Some(map);
    }
    let mut key: Option<String> = None;
    for line in lines {
        if line.trim_end() == "---" {
            return Some(map);
        }
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        if line.starts_with([' ', '\t']) {
            // Continuation of a folded or literal scalar.
            let current = map.get_mut(key.as_ref()?)?;
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(line.trim());
            continue;
        }
        let (name, value) = line.split_once(':')?;
        let value = value.trim();
        let value = if matches!(value, ">" | "|" | ">-" | "|-") {
            ""
        } else {
            value.trim_matches(['"', '\''])
        };
        key = Some(name.trim().to_owned());
        map.insert(name.trim().to_owned(), value.to_owned());
    }
    None
}

fn strip_frontmatter(text: &str) -> &str {
    let Some(rest) = text.strip_prefix("---\n") else {
        return text;
    };
    rest.split_once("\n---").map_or(text, |(_, body)| body)
}
