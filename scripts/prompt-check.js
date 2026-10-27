#!/usr/bin/env node
'use strict';
// UserPromptSubmit hook: before each message, checks whether this chat's
// rules changed since Claude last saw them:
//   - the user edited a rules file by hand
//   - the chat was filed under another sidebar group (a different project)
//   - the chat or its group was renamed (its rules file is renamed to match)
// If something changed, Claude gets the updated rules and the user a short
// note. If nothing did, it prints nothing, so a normal message costs one
// quick look at a few small files.

const { resolve, homeDir, checkSessionId } = require('./lib/where');
const rulebook = require('./lib/rulebook');
const snapshot = require('./lib/snapshot');
const { commandPrefix } = require('./rules');
const { readInput } = require('./session-start');

function hookOutput(input, env = process.env) {
  if (!input.session_id) return null;
  try {
    const before = snapshot.read(homeDir(env), checkSessionId(input.session_id));
    const where = resolve({
      sessionId: input.session_id,
      cwd: env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd(),
      transcriptPath: input.transcript_path,
      env,
      hints: before || {},
    });
    const state = rulebook.load(where, { hints: before || {} });
    const after = snapshot.capture(state);
    snapshot.write(where.home, where.sessionId, after);

    // No snapshot: SessionStart didn't run (say, the plugin was turned on
    // mid-chat), so give the full rules once.
    const changes = before ? snapshot.changes(before, after) : ['Loaded the rules for this chat.'];
    const notices = snapshot.newNotices(before, after);
    if (!changes.length && !notices.length) return null;

    const forUser = [];
    if (changes.length) forUser.push('CC Rules updated:', ...changes.map((line) => `  ${line}`));
    for (const notice of notices) forUser.push(`CC Rules: ${notice}`);

    let forClaude;
    if (changes.length) {
      forClaude = [
        'The chat rules changed since you last saw them:',
        ...changes.map((line) => `- ${line}`),
        'The full list below replaces any earlier list of chat rules.',
        '',
        rulebook.contextText(state, commandPrefix(where.cwd, where.sessionId)),
      ].join('\n');
    } else {
      forClaude = ['CC Rules notes (the rules themselves are unchanged):', ...notices.map((n) => `- ${n}`)].join('\n');
    }
    return {
      systemMessage: forUser.join('\n'),
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: forClaude },
    };
  } catch (err) {
    return { systemMessage: `CC Rules couldn't check the rules: ${err.message}` };
  }
}

if (require.main === module) {
  const out = hookOutput(readInput());
  if (out) process.stdout.write(JSON.stringify(out));
}
