#!/usr/bin/env bash
# Copies the packaged app over the one in Applications. Run with `pnpm run install:app`, after
# `pnpm dist`. A copy rather than a symlink because Spotlight does not index through symlinks, and
# a menu bar app with no dock icon is mostly launched by typing its name.
set -euo pipefail

app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_app="$app_dir/release/mac-arm64/PRoctologist.app"
destination_dir="${1:-/Applications}"
destination_app="$destination_dir/PRoctologist.app"

if [[ ! -d "$source_app" ]]; then
	echo "No build at $source_app. Run 'pnpm dist' first." >&2
	exit 1
fi

# A symlink left over from an earlier approach would make rsync write through it into the build.
if [[ -L "$destination_app" ]]; then
	echo "$destination_app is a symlink. Remove it first: rm '$destination_app'" >&2
	exit 1
fi

rsync --archive --delete "$source_app/" "$destination_app/"

# The build is unsigned, so Gatekeeper would otherwise refuse the fresh copy.
xattr -dr com.apple.quarantine "$destination_app"

echo "Installed $destination_app"
