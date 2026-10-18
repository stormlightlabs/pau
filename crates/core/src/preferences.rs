//! Operator interface preferences stored in Pau's database.
//!
//! Preferences are one versioned JSON document in the application settings
//! table, so the shape can grow without a schema migration. Known keys are
//! validated, and unknown keys are rejected on write so a typo never looks
//! like a saved setting.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::persistence::{ApplicationSetting, ApplicationSettingsRepository, Result};

/// Settings key holding the preferences document.
pub const UI_PREFERENCES_KEY: &str = "ui.preferences";

/// Document version this build reads and writes.
pub const UI_PREFERENCES_VERSION: u32 = 1;

/// Narrowest stored pane width in CSS pixels.
pub const MIN_PANE_WIDTH: u32 = 120;

/// Widest stored pane width in CSS pixels.
pub const MAX_PANE_WIDTH: u32 = 2000;

/// A bundled color theme. Names match the desktop app's theme identifiers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename_all = "kebab-case")]
pub enum ThemePreference {
    /// Eldritch.
    #[default]
    Eldritch,
    /// Nord.
    Nord,
    /// Iceberg.
    Iceberg,
    /// Catppuccin Mocha.
    CatppuccinMocha,
    /// Vitesse Dark.
    VitesseDark,
}

/// A bundled interface typeface. Names match the desktop app's font
/// identifiers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename_all = "kebab-case")]
pub enum UiFontPreference {
    /// Overpass, the default.
    #[default]
    Overpass,
    /// IBM Plex Sans.
    IbmPlexSans,
    /// Inter.
    Inter,
    /// Atkinson Hyperlegible Next.
    AtkinsonHyperlegibleNext,
    /// Atkinson Hyperlegible Soft.
    AtkinsonHyperlegibleSoft,
}

/// Which events raise a desktop notification.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum NotificationPolicy {
    /// Notify only when a session needs the operator's attention.
    #[default]
    Attention,
    /// Notify when a session finishes or needs attention.
    All,
    /// Never notify.
    Off,
}

/// Motion choice. `system` defers to the operating system's reduced-motion
/// setting.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum MotionPreference {
    /// Follow the operating system.
    #[default]
    System,
    /// Replace movement with fades.
    Reduce,
    /// Always animate.
    Full,
}

/// Widths of the resizable panes in CSS pixels. `None` keeps the default.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PaneWidths {
    /// Context rail width.
    pub context_rail: Option<u32>,
    /// Inspector width.
    pub inspector: Option<u32>,
}

/// The view to restore on launch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct LastRoute {
    /// Workspace that was open.
    pub workspace_id: String,
    /// Session that was open in the workspace, if any.
    pub session_id: Option<String>,
}

/// Every interface preference.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct UiPreferences {
    /// Document version. Writes must send [`UI_PREFERENCES_VERSION`].
    pub version: u32,
    /// Color scheme.
    pub theme: ThemePreference,
    /// Interface typeface.
    pub ui_font: UiFontPreference,
    /// Notification policy.
    pub notifications: NotificationPolicy,
    /// Motion setting.
    pub motion: MotionPreference,
    /// Resizable pane widths.
    pub pane_widths: PaneWidths,
    /// View to restore on launch.
    pub last_route: Option<LastRoute>,
}

impl UiPreferences {
    /// The preferences used before anything is saved.
    pub fn defaults() -> Self {
        Self {
            version: UI_PREFERENCES_VERSION,
            ..Self::default()
        }
    }

    /// Checks a document a client wants to save.
    pub fn validate(&self) -> std::result::Result<(), String> {
        if self.version != UI_PREFERENCES_VERSION {
            return Err(format!(
                "preferences version {} is not supported; use {UI_PREFERENCES_VERSION}",
                self.version
            ));
        }
        for (name, width) in [
            ("context_rail", self.pane_widths.context_rail),
            ("inspector", self.pane_widths.inspector),
        ] {
            if let Some(width) = width
                && !(MIN_PANE_WIDTH..=MAX_PANE_WIDTH).contains(&width)
            {
                return Err(format!(
                    "pane width {name} must be {MIN_PANE_WIDTH} to {MAX_PANE_WIDTH}"
                ));
            }
        }
        if let Some(route) = &self.last_route
            && (route.workspace_id.is_empty()
                || route.session_id.as_deref().is_some_and(str::is_empty))
        {
            return Err("last_route ids must not be empty".to_owned());
        }
        Ok(())
    }
}

/// Reads and writes the preferences document.
#[derive(Clone)]
pub struct UiPreferencesStore {
    settings: ApplicationSettingsRepository,
}

impl UiPreferencesStore {
    /// Stores preferences in `settings`.
    pub fn new(settings: ApplicationSettingsRepository) -> Self {
        Self { settings }
    }

    /// Returns the saved preferences, or the defaults when nothing is saved.
    ///
    /// A document that is unreadable, or written by a newer version, also
    /// yields the defaults. It stays in the database untouched until the next
    /// save replaces it, so an older build never edits what it cannot read.
    pub async fn load(&self) -> Result<UiPreferences> {
        let stored = self.settings.get(UI_PREFERENCES_KEY).await?;
        Ok(stored
            .and_then(|setting| serde_json::from_str::<UiPreferences>(&setting.value).ok())
            .filter(|preferences| preferences.version == UI_PREFERENCES_VERSION)
            .unwrap_or_else(UiPreferences::defaults))
    }

    /// Replaces the saved preferences. Callers validate first.
    pub async fn save(&self, preferences: &UiPreferences, updated_at: String) -> Result<()> {
        self.settings
            .set(ApplicationSetting {
                key: UI_PREFERENCES_KEY.to_owned(),
                value: serde_json::to_string(preferences).expect("preferences are serializable"),
                updated_at,
            })
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Database;

    async fn store() -> (Database, UiPreferencesStore) {
        let database = Database::open(":memory:").await.unwrap();
        let store = UiPreferencesStore::new(database.settings());
        (database, store)
    }

    #[tokio::test]
    async fn reads_defaults_then_saved_values() {
        let (_database, store) = store().await;
        assert_eq!(store.load().await.unwrap(), UiPreferences::defaults());

        let mut preferences = UiPreferences::defaults();
        preferences.theme = ThemePreference::CatppuccinMocha;
        preferences.motion = MotionPreference::Reduce;
        preferences.pane_widths.inspector = Some(420);
        preferences.last_route = Some(LastRoute {
            workspace_id: "w1".to_owned(),
            session_id: None,
        });
        preferences.validate().unwrap();
        store
            .save(&preferences, "2026-01-01T00:00:00Z".to_owned())
            .await
            .unwrap();
        assert_eq!(store.load().await.unwrap(), preferences);
    }

    #[test]
    fn rejects_unknown_keys_and_out_of_range_values() {
        let unknown = r#"{"version":1,"theme":"nord","ui_font":"inter","notifications":"all",
            "motion":"full","pane_widths":{},"last_route":null,"zoom":2}"#;
        assert!(serde_json::from_str::<UiPreferences>(unknown).is_err());
        let light = unknown.replace("nord", "light").replace(",\"zoom\":2", "");
        assert!(serde_json::from_str::<UiPreferences>(&light).is_err());
        let known = unknown.replace(",\"zoom\":2", "");
        let parsed = serde_json::from_str::<UiPreferences>(&known).unwrap();
        assert_eq!(parsed.theme, ThemePreference::Nord);
        assert_eq!(parsed.ui_font, UiFontPreference::Inter);
        let plex = known.replace("inter", "ibm-plex-sans");
        let parsed = serde_json::from_str::<UiPreferences>(&plex).unwrap();
        assert_eq!(parsed.ui_font, UiFontPreference::IbmPlexSans);
        assert_eq!(UiPreferences::defaults().ui_font, UiFontPreference::Overpass);

        let mut preferences = UiPreferences::defaults();
        preferences.pane_widths.context_rail = Some(5);
        assert!(preferences.validate().is_err());
        preferences.pane_widths.context_rail = None;
        preferences.version = UI_PREFERENCES_VERSION + 1;
        assert!(preferences.validate().is_err());
    }

    #[tokio::test]
    async fn ignores_a_document_from_a_newer_version() {
        let (database, store) = store().await;
        let newer = r#"{"version":2,"theme":"dark","future":true}"#;
        database
            .settings()
            .set(ApplicationSetting {
                key: UI_PREFERENCES_KEY.to_owned(),
                value: newer.to_owned(),
                updated_at: "2026-01-01T00:00:00Z".to_owned(),
            })
            .await
            .unwrap();
        assert_eq!(store.load().await.unwrap(), UiPreferences::defaults());
        let kept = database.settings().get(UI_PREFERENCES_KEY).await.unwrap();
        assert_eq!(kept.unwrap().value, newer);
    }
}
