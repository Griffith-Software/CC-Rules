#!/usr/bin/env node
'use strict';
// SessionStart hook: loads the active global, project and chat rules into
// Claude's context and shows the user a short list of them. Runs at startup,
// resume, /clear and after compaction, so the rules survive a compacted
// context.
//
// Never fails the session: any problem is reported to the user instead.

const fs = require('node:fs');
const { resolve } = require('./lib/where');
const rulebook = require('./lib/rulebook');
const snapshot = require('./lib/snapshot');
const { commandPrefix } = require('./rules');

function readInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function hookOutput(input, env = process.env) {
  try {
    const where = resolve({
      sessionId: input.session_id || null,
      cwd: env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd(),
      sessionTitle: input.session_title,
      transcriptPath: input.transcript_path,
      env,
    });
    const previous = where.sessionId ? snapshot.read(where.home, where.sessionId) : null;
    const state = rulebook.load(where, { hints: previous || {} });
    if (where.sessionId) {
      snapshot.write(where.home, where.sessionId, snapshot.capture(state));
      snapshot.prune(where.home);
    }
    return {
      systemMessage: rulebook.summaryText(state),
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: rulebook.contextText(state, commandPrefix(where.cwd, where.sessionId)),
      },
    };
  } catch (err) {
    return { systemMessage: `CC Rules couldn't load the rules: ${err.message}` };
  }
}

if (require.main === module) {
  process.stdout.write(JSON.stringify(hookOutput(readInput())));
}

module.exports = { readInput };
