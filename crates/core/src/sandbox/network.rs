//! Network grant syntax and proxy exclusions.

use std::net::{IpAddr, Ipv4Addr};

use super::SandboxError;

/// The `NO_PROXY` list that sandbox-runtime 0.0.77 sets inside the sandbox.
const RUNTIME_NO_PROXY: &[&str] = &[
    "localhost",
    "127.0.0.1",
    "::1",
    "169.254.0.0/16",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
];

pub(super) fn validate_domain(domain: &str) -> Result<(), SandboxError> {
    let invalid = || SandboxError::Invalid(format!("{domain:?} is not a host or host:port"));
    let (host, port) = split_host_port(domain).ok_or_else(invalid)?;
    if let Some(port) = port
        && (port.is_empty() || port.parse::<u16>().map_or(true, |port| port == 0))
    {
        return Err(invalid());
    }
    if host.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    if host.eq_ignore_ascii_case("localhost") {
        return Ok(());
    }
    // sandbox-runtime accepts only names with a dot, and a wildcard needs at
    // least two labels after it, so `*.com` and single-label names are refused
    // here instead of at launch.
    let name = host.strip_prefix("*.").unwrap_or(host);
    let labels = name.split('.').count();
    if labels < 2 {
        return Err(invalid());
    }
    let valid_label = |label: &str| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
    };
    if name.is_empty() || !name.split('.').all(valid_label) {
        return Err(invalid());
    }
    Ok(())
}

/// Splits `host`, `host:port`, `[v6]`, or `[v6]:port`.
pub(super) fn split_host_port(domain: &str) -> Option<(&str, Option<&str>)> {
    if let Some(rest) = domain.strip_prefix('[') {
        let (host, rest) = rest.split_once(']')?;
        return match rest {
            "" => Some((host, None)),
            _ => Some((host, Some(rest.strip_prefix(':')?))),
        };
    }
    match domain.split_once(':') {
        Some((host, port)) if !port.contains(':') => Some((host, Some(port))),
        Some(_) => None,
        None => Some((domain, None)),
    }
}

/// Returns the `NO_PROXY` value to use inside the sandbox.
///
/// On Linux the sandbox has no network interface, so a client that honors
/// sandbox-runtime's `NO_PROXY` and connects directly to a granted local
/// address fails. Removing the covering entry sends that request through the
/// proxy, which still enforces the grant. The value is always explicit so a
/// running tool host can replace it when the grants change.
pub(super) fn proxy_exclusions(domains: &[String]) -> String {
    let hosts = domains
        .iter()
        .filter_map(|domain| split_host_port(domain).map(|(host, _)| host))
        .collect::<Vec<_>>();
    RUNTIME_NO_PROXY
        .iter()
        .filter(|entry| !hosts.iter().any(|host| no_proxy_entry_covers(entry, host)))
        .copied()
        .collect::<Vec<_>>()
        .join(",")
}

fn no_proxy_entry_covers(entry: &str, host: &str) -> bool {
    if entry.eq_ignore_ascii_case(host) {
        return true;
    }
    let (Some((network, prefix)), Ok(IpAddr::V4(address))) =
        (entry.split_once('/'), host.parse::<IpAddr>())
    else {
        return false;
    };
    let (Ok(network), Ok(prefix)) = (network.parse::<Ipv4Addr>(), prefix.parse::<u32>()) else {
        return false;
    };
    let mask = u32::MAX.checked_shl(32 - prefix).unwrap_or(0);
    u32::from(address) & mask == u32::from(network) & mask
}

pub(super) fn is_local_destination(domain: &str) -> bool {
    split_host_port(domain).is_some_and(|(host, _)| {
        host.eq_ignore_ascii_case("localhost")
            || match host.parse::<IpAddr>() {
                Ok(IpAddr::V4(address)) => {
                    address.is_loopback() || address.is_private() || address.is_link_local()
                }
                Ok(IpAddr::V6(address)) => address.is_loopback(),
                Err(_) => false,
            }
    })
}
