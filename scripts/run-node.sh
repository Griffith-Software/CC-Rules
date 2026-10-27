#!/bin/sh
# Starts a CC Rules script with Node.js, for the hooks.
#
#   sh run-node.sh [--quiet] script.js
#
# Uses the plugin's "Node.js path" option when it is set (Claude Code exports
# it as CLAUDE_PLUGIN_OPTION_NODE_PATH), otherwise the node on PATH. If neither
# works, it tells the user how to fix it instead of failing the session;
# --quiet skips that message (the per-message check uses it, so the problem
# is reported once, at chat start, rather than on every message).

quiet=
if [ "$1" = "--quiet" ]; then
  quiet=1
  shift
fi

say() {
  # Hook output with a message for the user. Messages are fixed text, so
  # nothing needs escaping.
  [ -n "$quiet" ] || printf '{"systemMessage":"CC Rules: %s"}\n' "$1"
  exit 0
}

node_bin=${CLAUDE_PLUGIN_OPTION_NODE_PATH:-}
if [ -n "$node_bin" ]; then
  # A folder is fine too: look for node inside it.
  if [ -d "$node_bin" ]; then
    for name in node.exe node; do
      if [ -f "$node_bin/$name" ]; then
        node_bin="$node_bin/$name"
        break
      fi
    done
  fi
  [ -f "$node_bin" ] || say "the plugin's Node.js path doesn't point to node, so no rules were loaded. Fix it with: claude plugin configure cc-rules@cc-rules"
else
  node_bin=$(command -v node 2>/dev/null) || node_bin=
  [ -n "$node_bin" ] || say "Node.js wasn't found, so no rules were loaded. Set the plugin's Node.js path (claude plugin configure cc-rules@cc-rules) or put node on PATH."
fi

exec "$node_bin" "$@"
