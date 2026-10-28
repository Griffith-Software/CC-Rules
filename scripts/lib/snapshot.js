'use strict';
// Remembers what Claude was last told about a chat's rules, so the check
// before each message can stay silent until something actually changes.
// Snapshots live in <home>/.state/<session ID>.json.

const fs = require('node:fs');
const path = require('node:path');
const { allRules, renumberText } = require('./rulebook');

const LEVEL_WORD = { global: 'global', project: 'project', chat: 'this chat' };

function snapshotFile(home, sessionId) {
  return path.join(home, '.state', `${sessionId}.json`);
}

function read(home, sessionId) {
  try {
    return JSON.parse(fs.readFileSync(snapshotFile(home, sessionId), 'utf8'));
  } catch {
    return null;
  }
}

function capture(state) {
  const { where } = state;
  return {
    project: where.project,
    chatTitle: where.chatTitle,
    desktopRecord: where.desktopRecord,
    projectFile: state.project.file,
    chatFile: state.chat ? state.chat.file : null,
    rules: allRules(state).map(({ doc, rule }) => ({
      id: rule.id,
      level: doc.level,
      active: rule.active,
      text: rule.text,
    })),
    notices: state.notices,
  };
}

function write(home, sessionId, snapshot) {
  try {
    const file = snapshotFile(home, sessionId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(snapshot));
  } catch {
    // Without a snapshot the next check just repeats the rules; no harm done.
  }
}

// Deletes snapshots of chats untouched for `days` days.
function prune(home, days = 30) {
  const dir = path.join(home, '.state');
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    } catch {
      // Gone already, or busy: try again another day.
    }
  }
}

// Pairs each rule now with the rule it was before. IDs change when rules
// above them go, so rules are matched by their wording first: at the same
// level, then at any level (a move). A rule whose wording changed is matched
// by its ID, unless the chat changed project, when the same ID is another
// project's rule.
function match(before, after) {
  const left = [...before.rules];
  const take = (test) => {
    const i = left.findIndex(test);
    return i === -1 ? null : left.splice(i, 1)[0];
  };
  const pairs = after.rules.map((rule) => ({ rule, was: take((r) => r.level === rule.level && r.text === rule.text) }));
  for (const pair of pairs) if (!pair.was) pair.was = take((r) => r.text === pair.rule.text);
  const sameProject = before.project.id === after.project.id;
  for (const pair of pairs) {
    const { rule } = pair;
    if (pair.was || (rule.level === 'project' && !sameProject)) continue;
    pair.was = take((r) => r.level === rule.level && r.id === rule.id);
  }
  return { pairs, gone: left };
}

// What changed between two snapshots, as lines for the user and Claude.
function changes(before, after) {
  const out = [];
  if (before.project.id !== after.project.id) {
    out.push(`This chat is now in project "${after.project.name}".`);
  } else if (before.project.name !== after.project.name) {
    out.push(`Project "${before.project.name}" is now called "${after.project.name}".`);
  }
  const { pairs, gone } = match(before, after);
  const renumbered = { global: [], project: [], chat: [] };
  for (const { rule, was } of pairs) {
    const level = LEVEL_WORD[rule.level];
    if (!was) {
      out.push(`${rule.id} (${level}) ${rule.active ? 'now applies' : 'was added, paused'}: ${rule.text}`);
      continue;
    }
    if (was.level !== rule.level) {
      out.push(`${was.id} moved from ${LEVEL_WORD[was.level]} to ${level} and is now ${rule.id}`);
    } else if (was.id !== rule.id) {
      renumbered[rule.level].push([was.id, rule.id]);
    }
    if (was.text !== rule.text) out.push(`${rule.id} (${level}) now says: ${rule.text}`);
    if (was.active !== rule.active) out.push(`${rule.id} (${level}) ${rule.active ? 'resumed' : 'paused'}`);
  }
  for (const rule of gone) out.push(`${rule.id} (${LEVEL_WORD[rule.level]}) no longer applies: ${rule.text}`);
  for (const [level, list] of Object.entries(renumbered)) if (list.length) out.push(renumberText(level, list));
  return out;
}

// Notices in `after` that weren't shown last time.
function newNotices(before, after) {
  const shown = new Set((before && before.notices) || []);
  return after.notices.filter((notice) => !shown.has(notice));
}

module.exports = { read, capture, write, prune, changes, newNotices };
