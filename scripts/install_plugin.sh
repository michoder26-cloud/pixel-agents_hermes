#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLUGIN_SRC="$PROJECT_DIR/hermes-plugin/pixel_observer"
PLUGIN_DST="$HOME/.hermes/plugins/pixel_observer"

if [ ! -d "$PLUGIN_SRC" ]; then
    echo "ERROR: Plugin source not found at $PLUGIN_SRC"
    exit 1
fi

mkdir -p "$HOME/.hermes/plugins"
cp -r "$PLUGIN_SRC" "$PLUGIN_DST"
echo "✓ Plugin copied to $PLUGIN_DST"

if command -v hermes &> /dev/null; then
    hermes plugins enable pixel_observer 2>&1 || true
    echo "✓ Plugin enabled (takes effect on next session)"
else
    echo "⚠ Hermes CLI not found. Enable manually: hermes plugins enable pixel_observer"
fi
