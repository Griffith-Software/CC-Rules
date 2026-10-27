'use strict';
// Works out which rule files apply to a chat, highest level first:
//
//   global   <home>/GLOBAL.md                         every chat
//   project  <home>/projects/<group name>.md          chats filed in a desktop sidebar group
//            <folder>/.claude/cc-rules/PROJECT.md     chats in no group, by the folder they run in
//   chat     <home>/chats/<chat name>.md              one chat
//
// <home> is ~/.claude/cc-rules ($CC_RULES_HOME overrides it). Group and
// chat files are found by the "Linked to ..." line inside them, not by their
// names, so the rules follow a renamed group or chat (see rulebook.js).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const desktop = require('./desktop');

// Errors the user can fix (bad ID, missing session...). The CLI prints the
// message alone, without a stack trace.
class RulesError extends Error {}

// Claude Code session IDs are UUIDs. Anything that could leave a folder
// (slashes, "..") is refused.
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function checkSessionId(sessionId) {
  if (!SESSION_RE.test(String(sessionId))) {
    throw new RulesError(`"${sessionId}" isn't a valid chat session ID.`);
  }
  return String(sessionId);
}

function claudeDir(env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function homeDir(env = process.env) {
  return env.CC_RULES_HOME || path.join(claudeDir(env), 'cc-rules');
}

function cleanName(name) {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() || null : null;
}

// The newest name Claude Code recorded in the chat's transcript, if any
// (from /rename, --name or the desktop app).
function transcriptTitle(file) {
  if (!file) return null;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const at = text.lastIndexOf('"type":"custom-title"');
  if (at === -1) return null;
  const start = text.lastIndexOf('\n', at) + 1;
  const end = text.indexOf('\n', at);
  try {
    return cleanName(JSON.parse(text.slice(start, end === -1 ? undefined : end)).customTitle);
  } catch {
    return null;
  }
}

function findTranscript(env, sessionId) {
  const projects = path.join(claudeDir(env), 'projects');
  let dirs = [];
  try {
    dirs = fs.readdirSync(projects);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const file = path.join(projects, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// { sessionId, cwd, home, project: { kind, id, name }, groups, chatTitle, desktopRecord, warnings }
// project.kind is "group" (id = the group's ID) or "folder" (id = the folder);
// groups lists every desktop sidebar group, for moving a rule to another one.
function resolve({ sessionId = null, cwd = process.cwd(), sessionTitle, transcriptPath, env = process.env, hints = {} } = {}) {
  if (sessionId) checkSessionId(sessionId);
  const where = {
    sessionId: sessionId || null,
    cwd: path.resolve(cwd),
    home: homeDir(env),
    project: null,
    groups: [],
    chatTitle: null,
    desktopRecord: null,
    desktopConfig: null,
    warnings: [],
  };
  const info = sessionId ? desktop.lookup(sessionId, { env, hint: hints.desktopRecord }) : null;
  if (info) {
    where.desktopRecord = info.recordFile;
    where.desktopConfig = info.configFile;
    where.groups = (info.groups || []).map((g) => ({ id: g.id, name: cleanName(g.name) || 'Unnamed group' }));
    where.chatTitle = cleanName(info.title);
    if (info.warning) where.warnings.push(`${info.warning}, so this chat uses its folder's project rules.`);
  }
  where.project =
    info && info.group
      ? { kind: 'group', id: info.group.id, name: cleanName(info.group.name) || 'Unnamed group' }
      : { kind: 'folder', id: where.cwd, name: path.basename(where.cwd) || where.cwd };
  if (sessionId && !where.chatTitle) {
    where.chatTitle = cleanName(sessionTitle) || transcriptTitle(transcriptPath || findTranscript(env, sessionId));
  }
  return where;
}

module.exports = { RulesError, checkSessionId, claudeDir, homeDir, resolve };
