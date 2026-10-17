#!/bin/sh
# Builds a tagged Pau release from source on this Mac and installs it.
#
# Usage:
#   sh scripts/install.sh [VERSION] [--unsigned]
#   curl -fsSL <url-of-this-script> | sh -s -- [VERSION] [--unsigned]
#
# Without VERSION (or PAU_VERSION), the script lists recent release tags and
# asks which one to build, defaulting to the newest. Without a terminal it
# builds the newest tag.
#
# The build runs in a temporary Git worktree at the release tag, so the
# checkout you work in is never switched or required to be clean. Signing and
# notarization credentials come from the environment or the checkout's .env, as
# for `pnpm release:macos`. With --unsigned, the app is built without them and
# left in the checkout's target/release-macos instead of /Applications.
#
# Run outside a checkout, the script clones PAU_REPO (default: the GitHub
# repository over SSH) into PAU_SOURCE_DIR (default: ~/.cache/pau/source).
set -eu

repo_url=${PAU_REPO:-git@github.com:stormlightlabs/pau.git}
version=${PAU_VERSION:-}
unsigned=

fail() {
	printf 'install.sh: %s\n' "$1" >&2
	exit 1
}

usage() {
	sed -n '2,19s/^# \{0,1\}//p' "$0" 2>/dev/null ||
		printf 'Usage: install.sh [VERSION] [--unsigned]\n'
}

for argument in "$@"; do
	case $argument in
	--unsigned) unsigned=--unsigned ;;
	-h | --help)
		usage
		exit 0
		;;
	-*) fail "unknown option $argument. Run with --help for usage." ;;
	*) version=$argument ;;
	esac
done

[ "$(uname -s)" = Darwin ] || fail "Pau releases are built on macOS."
[ "$(uname -m)" = arm64 ] || fail "Pau releases are built for Apple Silicon Macs."
for tool in git node pnpm cargo xcrun; do
	command -v "$tool" >/dev/null 2>&1 ||
		fail "$tool is not on PATH. See the macOS section of README.md."
done

# Use the checkout that contains this script when there is one. Piped through
# sh, $0 is the shell rather than a file, so fall back to a cached clone.
source_dir=
if [ -f "$0" ]; then
	script_dir=$(cd "$(dirname "$0")" && pwd)
	source_dir=$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null || true)
fi
if [ -z "$source_dir" ]; then
	source_dir=${PAU_SOURCE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/pau/source}
	if [ ! -d "$source_dir/.git" ]; then
		printf 'Cloning %s into %s\n' "$repo_url" "$source_dir"
		mkdir -p "$(dirname "$source_dir")"
		git clone --quiet "$repo_url" "$source_dir"
	fi
fi

git -C "$source_dir" fetch --quiet --tags origin 2>/dev/null ||
	printf 'Could not fetch tags from origin. Using the tags already present.\n' >&2

tags=$(git -C "$source_dir" tag --list 'v*' --sort=-v:refname)
[ -n "$tags" ] || fail "no release tags found in $source_dir."
latest=$(printf '%s\n' "$tags" | head -n 1)

if [ -z "$version" ] && { : </dev/tty; } 2>/dev/null; then
	{
		printf 'Recent releases:\n'
		printf '%s\n' "$tags" | head -n 5 | sed 's/^/  /'
		printf 'Version to install [%s]: ' "$latest"
	} >/dev/tty
	read -r version </dev/tty || version=
fi
version=${version:-$latest}
tag=v${version#v}

git -C "$source_dir" rev-parse --verify --quiet "refs/tags/$tag" >/dev/null ||
	fail "there is no release tag $tag. The newest is $latest."
git -C "$source_dir" cat-file -e "$tag:apps/desktop/scripts/release-macos.mjs" 2>/dev/null ||
	fail "$tag predates the macOS release script. Choose v0.6.0 or later."

build_root=$(mktemp -d "${TMPDIR:-/tmp}/pau-release.XXXXXX")
worktree=$build_root/pau-${tag#v}
cleanup() {
	git -C "$source_dir" worktree remove --force "$worktree" 2>/dev/null || true
	rm -rf "$build_root"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

printf 'Building Pau %s in %s\n' "${tag#v}" "$worktree"
git -C "$source_dir" worktree add --quiet --detach "$worktree" "$tag"
if [ -f "$source_dir/.env" ]; then
	cp "$source_dir/.env" "$worktree/.env"
fi

cd "$worktree"
pnpm install --frozen-lockfile
pnpm release:macos $unsigned

if [ -n "$unsigned" ]; then
	destination=$source_dir/target/release-macos/Pau.app
	mkdir -p "$(dirname "$destination")"
	rm -rf "$destination"
	mv "$worktree/target/release-macos/Pau.app" "$destination"
	printf 'Unsigned Pau %s is at %s\n' "${tag#v}" "$destination"
fi
