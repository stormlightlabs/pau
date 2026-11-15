//! Runs the sandboxed terminal relay: `pau-term --pau-term-relay <program> [args...]`.
//!
//! The desktop app and `pau-server` accept the same arguments, so this binary
//! exists for tests and for running the relay on its own.

fn main() {
    pau_term::relay::run_if_requested();
    eprintln!(
        "usage: pau-term {} <program> [args...]",
        pau_term::relay::RELAY_ARGUMENT
    );
    std::process::exit(2);
}
