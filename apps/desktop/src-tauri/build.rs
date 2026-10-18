fn main() {
    // Declaring the app's commands makes each one require a permission, so the
    // capability files decide which windows may call it.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["startup_progress"])),
    )
    .expect("failed to run the Tauri build script");
}
