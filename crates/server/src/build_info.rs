//! Release or development identity of this build, shared by `build.rs` and the
//! server so both apply the same rules.
#![allow(dead_code, reason = "build.rs and the library each use a subset")]

/// Whether a build is a tagged release or an untagged development build.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channel {
    Release,
    Dev,
}

impl Channel {
    /// Name emitted by `build.rs` and accepted by `PAU_BUILD_CHANNEL`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Release => "release",
            Self::Dev => "dev",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "release" => Some(Self::Release),
            "dev" => Some(Self::Dev),
            _ => None,
        }
    }

    /// Directory under the local data directory that holds this build's state,
    /// so development builds never open the release database.
    pub fn data_dir_name(self) -> &'static str {
        match self {
            Self::Release => "pau",
            Self::Dev => "pau-dev",
        }
    }
}

/// A build is a release only when HEAD is exactly at the tag `v<version>`.
pub fn channel_for_tag(tag: Option<&str>, version: &str) -> Channel {
    match tag {
        Some(tag) if tag.strip_prefix('v') == Some(version) => Channel::Release,
        _ => Channel::Dev,
    }
}

/// `0.2.0` for releases, `0.2.0-dev+<commit>` for development builds.
pub fn version_string(version: &str, channel: Channel, commit: Option<&str>) -> String {
    match (channel, commit) {
        (Channel::Release, _) => version.to_owned(),
        (Channel::Dev, Some(commit)) => format!("{version}-dev+{commit}"),
        (Channel::Dev, None) => format!("{version}-dev"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_matching_tag_is_a_release() {
        assert_eq!(channel_for_tag(Some("v0.2.0"), "0.2.0"), Channel::Release);
        assert_eq!(channel_for_tag(Some("v0.1.0"), "0.2.0"), Channel::Dev);
        assert_eq!(channel_for_tag(None, "0.2.0"), Channel::Dev);
    }

    #[test]
    fn version_strings_follow_the_channel() {
        assert_eq!(
            version_string("0.2.0", Channel::Release, Some("abc1234")),
            "0.2.0"
        );
        assert_eq!(
            version_string("0.2.0", Channel::Dev, Some("abc1234")),
            "0.2.0-dev+abc1234"
        );
        assert_eq!(version_string("0.2.0", Channel::Dev, None), "0.2.0-dev");
    }

    #[test]
    fn dev_state_lives_beside_release_state() {
        assert_eq!(Channel::Release.data_dir_name(), "pau");
        assert_eq!(Channel::Dev.data_dir_name(), "pau-dev");
        assert_eq!(Channel::parse(Channel::Dev.as_str()), Some(Channel::Dev));
    }
}
