//! Decides once whether this is a tagged release or a development build.
//!
//! `PAU_BUILD_CHANNEL=release|dev` overrides detection for CI and release
//! builds. Otherwise HEAD must sit exactly at the tag `v<workspace version>`.

use std::{env, process::Command};

#[path = "src/build_info.rs"]
mod build_info;

use build_info::{Channel, channel_for_tag, version_string};

fn git(args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).output().ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let text = text.trim();
    (output.status.success() && !text.is_empty()).then(|| text.to_owned())
}

fn main() {
    println!("cargo:rerun-if-env-changed=PAU_BUILD_CHANNEL");
    if let Some(head) = git(&["rev-parse", "--git-path", "HEAD"]) {
        println!("cargo:rerun-if-changed={head}");
    }

    let version = env::var("CARGO_PKG_VERSION").expect("cargo sets the package version");
    let channel = match env::var("PAU_BUILD_CHANNEL") {
        Ok(name) => Channel::parse(&name).expect("PAU_BUILD_CHANNEL must be release or dev"),
        Err(_) => channel_for_tag(
            git(&["describe", "--exact-match", "--tags", "--match", "v*"]).as_deref(),
            &version,
        ),
    };
    let commit = git(&["rev-parse", "--short", "HEAD"]);

    println!("cargo:rustc-env=PAU_BUILD_CHANNEL={}", channel.as_str());
    println!(
        "cargo:rustc-env=PAU_BUILD_VERSION={}",
        version_string(&version, channel, commit.as_deref())
    );
}
