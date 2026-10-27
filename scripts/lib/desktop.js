'use strict';
// Reads the Claude desktop app's own files to find a chat's name and the
// sidebar group (project) it's filed under. These files aren't an official
// interface, so every step checks what it finds, and an unfamiliar layout is
// reported as a warning instead of guessed at.
//
//   claude-code-sessions/<account>/<org>/local_<id>.json
//       { sessionId: "local_<id>", cliSessionId: "<Claude Code session ID>", title, ... }
//   claude_desktop_config.json
//       preferences.epitaxyPrefs["dframe-group-scopes"]["<account>/<org>"]
//           groups:      [{ id: "cg-...", name: "Apps" }]
//           assignments: { "code:local_<id>": "cg-..." }
//
// The folder that holds them has moved before (on Windows, from
// %APPDATA%\Claude to %LOCALAPPDATA%\Claude-Data\claude_<package> in October
// 2026), so it is found, not assumed. Claude Code started by the app also
// sets variables that point straight at it, used as hints with the folder
// search behind them: CLAUDE_CODE_ENTRYPOINT=claude-desktop,
// CLAUDE_CODE_EXECPATH (inside the data folder), CLAUDE_CODE_HOST_SESSION_ID
// (the chat's local_<id>) and CLAUDE_CODE_ACCOUNT_UUID /
// CLAUDE_CODE_ORGANIZATION_UUID (the <account>/<org> folders).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CONFIG = 'claude_desktop_config.json';
const SESSIONS = 'claude-code-sessions';
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function subdirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isDesktop(env) {
  return env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop';
}

function hasAppData(dir) {
  return fs.existsSync(path.join(dir, CONFIG)) || fs.existsSync(path.join(dir, SESSIONS));
}

// Folders the app's data may be in, most likely first. $CC_RULES_DESKTOP_DIR
// overrides them all.
function appDirs(env = process.env) {
  if (env.CC_RULES_DESKTOP_DIR) return [env.CC_RULES_DESKTOP_DIR];
  const dirs = [];
  // The Claude Code the app started runs from <data>/claude-code/<version>/<build>/.
  if (env.CLAUDE_CODE_EXECPATH) {
    const parts = path.resolve(env.CLAUDE_CODE_EXECPATH).split(path.sep);
    const at = parts.lastIndexOf('claude-code');
    if (at > 0) dirs.push(parts.slice(0, at).join(path.sep));
  }
  const home = os.homedir();
  if (process.platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    for (const name of subdirs(path.join(local, 'Claude-Data'))) dirs.push(path.join(local, 'Claude-Data', name));
    dirs.push(path.join(roaming, 'Claude'));
    for (const name of listDir(path.join(local, 'Packages')).filter((n) => /^Claude_/i.test(n))) {
      dirs.push(path.join(local, 'Packages', name, 'LocalCache', 'Roaming', 'Claude'));
    }
  } else if (process.platform === 'darwin') {
    dirs.push(path.join(home, 'Library', 'Application Support', 'Claude'));
  } else {
    dirs.push(path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude'));
  }
  return [...new Set(dirs)];
}

// The first of those folders that holds the app's data, or null.
function appDir(env = process.env) {
  return appDirs(env).find(hasAppData) || null;
}

function recordFor(file, sessionId) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(sessionId)) return null;
    const record = JSON.parse(text);
    return record && record.cliSessionId === sessionId ? record : null;
  } catch {
    return null;
  }
}

// The record the app's variables name for the chat it started, or null.
function hostRecordFile(dir, env) {
  const hostId = env.CLAUDE_CODE_HOST_SESSION_ID;
  const account = env.CLAUDE_CODE_ACCOUNT_UUID;
  const org = env.CLAUDE_CODE_ORGANIZATION_UUID;
  if (![hostId, account, org].every((v) => SAFE_NAME.test(v || ''))) return null;
  return path.join(dir, SESSIONS, account, org, `${hostId}.json`);
}

// True when the app's variables name a record that belongs to another chat:
// this Claude Code was started inside a desktop chat (from its shell, say)
// and inherited them, so it isn't a desktop chat itself.
function inheritedFromAnotherChat(dir, env, sessionId) {
  const file = dir && hostRecordFile(dir, env);
  if (!file) return false;
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof record.cliSessionId === 'string' && record.cliSessionId !== sessionId;
  } catch {
    return false;
  }
}

// The app's record of a Claude Code session, or null. Tries `hint` (where it
// was last time), then the record the app names for the running chat, then
// every record.
function findRecord(dir, sessionId, { hint, env }) {
  const root = path.join(dir, SESSIONS);
  const scopeOf = (file) => path.relative(root, path.dirname(file)).split(path.sep).join('/');
  const named = [];
  if (hint) named.push(hint);
  const host = hostRecordFile(dir, env);
  if (host && env.CLAUDE_CODE_SESSION_ID === sessionId) named.push(host);
  for (const file of named) {
    const record = recordFor(file, sessionId);
    if (record) return { file, record, scope: scopeOf(file) };
  }
  for (const accountDir of subdirs(root)) {
    for (const orgDir of subdirs(path.join(root, accountDir))) {
      const folder = path.join(root, accountDir, orgDir);
      for (const name of listDir(folder)) {
        if (!/^local_.+\.json$/.test(name)) continue;
        const file = path.join(folder, name);
        const record = recordFor(file, sessionId);
        if (record) return { file, record, scope: scopeOf(file) };
      }
    }
  }
  return null;
}

// What the desktop app knows about a chat:
//   null                                        not a desktop chat
//   { recordFile, configFile, title, group, groups }
//       group is { id, name } or null (no group); groups lists every sidebar group
//   ...plus warning                             when the app's files couldn't be read
function lookup(sessionId, { env = process.env, hint } = {}) {
  if (!sessionId) return null;
  const dir = appDir(env);
  const found = dir ? findRecord(dir, sessionId, { hint, env }) : null;
  if (!found) {
    // Inside the app but no record of this chat: the app may have moved its
    // files again. Say so rather than quietly using the folder's rules.
    if (!isDesktop(env) || inheritedFromAnotherChat(dir, env, sessionId)) return null;
    return {
      recordFile: null,
      configFile: null,
      title: null,
      group: null,
      warning: "CC Rules couldn't find the desktop app's record of this chat (the app may have moved its files)",
    };
  }
  const configFile = path.join(dir, CONFIG);
  const info = {
    recordFile: found.file,
    configFile,
    title: typeof found.record.title === 'string' ? found.record.title : null,
    group: null,
  };
  const unreadable = "CC Rules couldn't read the desktop app's sidebar groups (the app may have changed)";
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch {
    info.warning = unreadable;
    return info;
  }
  const scopes = config && config.preferences && config.preferences.epitaxyPrefs
    ? config.preferences.epitaxyPrefs['dframe-group-scopes']
    : undefined;
  if (scopes === undefined) return info; // no sidebar groups made yet
  if (!scopes || typeof scopes !== 'object' || typeof found.record.sessionId !== 'string') {
    info.warning = unreadable;
    return info;
  }
  const scope = scopes[found.scope];
  // Every group in the sidebar, for moving a rule to another project.
  info.groups = scope && Array.isArray(scope.groups)
    ? scope.groups.filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string').map((g) => ({ id: g.id, name: g.name }))
    : [];
  const groupId = scope && scope.assignments ? scope.assignments[`code:${found.record.sessionId}`] : undefined;
  if (!groupId) return info; // not filed in a group
  const group = Array.isArray(scope.groups) ? scope.groups.find((g) => g && g.id === groupId) : null;
  // An assignment to a group that no longer exists counts as no group.
  if (group && typeof group.name === 'string') info.group = { id: group.id, name: group.name };
  return info;
}

// Every desktop chat that isn't archived: its Claude Code session ID, name,
// folder, sidebar group and when it was last used, newest first. Empty
// outside the app or when its files can't be read.
function chats(env = process.env) {
  const dir = appDir(env);
  if (!dir) return [];
  let scopes = {};
  try {
    const config = JSON.parse(fs.readFileSync(path.join(dir, CONFIG), 'utf8'));
    scopes = (config.preferences && config.preferences.epitaxyPrefs && config.preferences.epitaxyPrefs['dframe-group-scopes']) || {};
  } catch {
    // No groups to name; the chats still count.
  }
  const root = path.join(dir, SESSIONS);
  const out = [];
  for (const account of subdirs(root)) {
    for (const org of subdirs(path.join(root, account))) {
      const scope = scopes[`${account}/${org}`] || {};
      const groups = Array.isArray(scope.groups) ? scope.groups : [];
      const assignments = scope.assignments || {};
      for (const name of listDir(path.join(root, account, org))) {
        if (!/^local_.+\.json$/.test(name)) continue;
        let record;
        try {
          record = JSON.parse(fs.readFileSync(path.join(root, account, org, name), 'utf8'));
        } catch {
          continue;
        }
        if (!record || record.isArchived || typeof record.cliSessionId !== 'string') continue;
        const group = groups.find((g) => g && g.id === assignments[`code:${record.sessionId}`]);
        out.push({
          sessionId: record.cliSessionId,
          title: typeof record.title === 'string' ? record.title : '',
          cwd: typeof record.cwd === 'string' ? record.cwd : '',
          group: group && typeof group.name === 'string' ? { id: group.id, name: group.name } : null,
          lastActivityAt: Number(record.lastActivityAt) || 0,
        });
      }
    }
  }
  return out.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

module.exports = { appDir, appDirs, lookup, chats };
