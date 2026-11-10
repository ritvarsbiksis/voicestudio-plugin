#!/bin/bash
# Starts the voicestudio MCP server (dist/server.js) for the plugin's `voicestudio` server.
#
# Options come from the plugin's userConfig: plugin.json's mcpServers maps them into VOICESTUDIO_PLUGIN_* through
# ${user_config.KEY}. The server itself reads those variables (and CLAUDE_PLUGIN_OPTION_<KEY> as a
# fallback), so this script only has to find a Node.js 18+ runtime and hand over.
#
# Claude Code may launch MCP servers without the user's shell profile, so nvm/volta/Homebrew folders
# are often not on PATH. This searches them. Set VOICESTUDIO_NODE to force a binary.
# stdout belongs to the MCP protocol: diagnostics go to stderr only.
set -euo pipefail

script_dir="${BASH_SOURCE[0]%/*}"
[[ "$script_dir" == "${BASH_SOURCE[0]}" ]] && script_dir=.
ROOT="$(cd "$script_dir/.." && pwd)"
SERVER="$ROOT/dist/server.js"
MIN_MAJOR=18

log() { echo "voicestudio-plugin: $*" >&2; }

# node_major BIN: prints the major version, or nothing when BIN does not run.
node_major() {
  local v
  v="$("$1" -v 2>/dev/null)" || return 0
  v="${v#v}"
  printf '%s' "${v%%.*}"
}

usable() {
  local bin="$1" major
  [[ -n "$bin" && -x "$bin" ]] || return 1
  major="$(node_major "$bin")"
  [[ "$major" =~ ^[0-9]+$ ]] && ((major >= MIN_MAJOR))
}

candidates=()
[[ -n "${VOICESTUDIO_NODE:-}" ]] && candidates+=("$VOICESTUDIO_NODE")
if command -v node >/dev/null 2>&1; then
  candidates+=("$(command -v node)")
fi
# nvm: newest installed version first.
if [[ -d "$HOME/.nvm/versions/node" ]]; then
  while IFS= read -r dir; do
    candidates+=("$dir/bin/node")
  done < <(ls -1d "$HOME"/.nvm/versions/node/v* 2>/dev/null | sort -rV 2>/dev/null || true)
fi
candidates+=(
  "$HOME/.volta/bin/node"
  "$HOME/.local/share/fnm/aliases/default/bin/node"
  "$HOME/.asdf/shims/node"
  "/opt/homebrew/bin/node"
  "/usr/local/bin/node"
  "/usr/bin/node"
)

NODE=""
for c in "${candidates[@]}"; do
  if usable "$c"; then
    NODE="$c"
    break
  fi
done

if [[ -z "$NODE" ]]; then
  log "Node.js $MIN_MAJOR or newer was not found. Install it (https://nodejs.org or 'brew install node')"
  log "or set VOICESTUDIO_NODE to the node binary."
  exit 1
fi

if [[ ! -f "$SERVER" ]]; then
  log "missing $SERVER. Build it with: cd \"$ROOT/server\" && npm install && npm run build"
  exit 1
fi

exec "$NODE" "$SERVER"
