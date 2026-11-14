use std::fmt;

/// An agent Pau can start sessions for.
///
/// Session requests and readiness entries name an agent by [`Self::id`].
/// Adding a variant adds the agent to every readiness report, in the order of
/// [`Self::ALL`].
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum AgentKind {
    /// Pi in RPC mode.
    Pi,
    /// Claude Code through the Claude bridge host.
    Claude,
}

impl AgentKind {
    /// Every supported agent, in the order readiness reports list them.
    pub const ALL: [Self; 2] = [Self::Pi, Self::Claude];

    /// Returns the agent named by `id`, or `None` when Pau does not support it.
    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|agent| agent.id() == id)
    }

    /// The identifier used in requests, events, and readiness reports.
    pub fn id(self) -> &'static str {
        match self {
            Self::Pi => "pi",
            Self::Claude => "claude",
        }
    }

    /// The agent's name as people know it.
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Pi => "Pi",
            Self::Claude => "Claude Code",
        }
    }
}

impl fmt::Display for AgentKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.id())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_round_trip() {
        for agent in AgentKind::ALL {
            assert_eq!(AgentKind::from_id(agent.id()), Some(agent));
        }
        assert_eq!(AgentKind::from_id("codex"), None);
        assert_eq!(AgentKind::from_id("Pi"), None);
    }
}
