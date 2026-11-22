'use strict';
// A record of every change to the rules, so a rule number written down before
// the numbers moved can still be traced to the rule it meant.
//
//   <home>/history.jsonl         one line per change, oldest first
//   <home>/history-state.json    what each rules file held last time, with a
//                                hidden key per rule that never changes
//
// Changes are found by comparing each file with what it held last time, so
// Claude's changes, the panel's and hand edits are all recorded the same way.
// A rule that leaves one file and appears in another, word for word, at the
// same moment is a move. Recording never stops the rules loading.

const fs = require('node:fs');
const path = require('node:path');

const LOG = 'history.jsonl';
const STATE = 'history-state.json';
const LEVELS = ['global', 'project', 'chat'];

// A rules file's identity, which survives renamed chats and groups.
function docKey(where, level) {
  if (level === 'global') return 'global';
  if (level === 'project') return `${where.project.kind}:${where.project.id}`;
  return `chat:${where.sessionId}`;
}

function docName(where, level) {
  if (level === 'global') return 'global rules';
  if (level === 'project') return `project "${where.project.name}"`;
  return `chat "${where.chatTitle || `Untitled chat ${String(where.sessionId).slice(0, 8)}`}"`;
}

function readState(home) {
  try {
    const known = JSON.parse(fs.readFileSync(path.join(home, STATE), 'utf8'));
    if (known && typeof known.next === 'number' && known.docs && typeof known.docs === 'object') return known;
  } catch {
    // First run, or unreadable: start again from what the files hold now.
  }
  return { next: 1, docs: {} };
}

// Pairs each rule now with the one it was: same wording first, then same ID.
function match(before, after) {
  const left = [...before];
  const take = (test) => {
    const i = left.findIndex(test);
    return i === -1 ? null : left.splice(i, 1)[0];
  };
  const pairs = after.map((rule) => ({ rule, was: take((r) => r.text === rule.text) }));
  for (const pair of pairs) if (!pair.was) pair.was = take((r) => r.id === pair.rule.id);
  return { pairs, gone: left };
}

// Compares the chat's three files with last time and appends what changed.
function record(state, { now = new Date() } = {}) {
  const { where } = state;
  const known = readState(where.home);
  const at = now.toISOString();
  const entries = [];
  const removed = [];
  const added = [];
  let changed = false;
  for (const level of LEVELS) {
    const doc = state[level];
    if (!doc) continue;
    const key = docKey(where, level);
    const name = docName(where, level);
    const rules = doc.rules.map((r) => ({ id: r.id, text: r.text, active: r.active }));
    const last = known.docs[key];
    if (!last) {
      // First sight of this file: note what it holds, as where history starts.
      const kept = rules.map((r) => ({ ...r, key: known.next++ }));
      for (const r of kept) entries.push({ at, action: 'listed', level, where: name, id: r.id, text: r.text, rule: r.key });
      known.docs[key] = { name, rules: kept };
      changed = true;
      continue;
    }
    const { pairs, gone } = match(last.rules, rules);
    const kept = [];
    for (const { rule, was } of pairs) {
      if (!was) {
        added.push({ level, name, rule, holder: kept, index: kept.length });
        kept.push(null);
        continue;
      }
      const base = { at, level, where: name, id: rule.id, text: rule.text, rule: was.key };
      if (was.text !== rule.text) entries.push({ ...base, action: 'edit', before: was.text });
      if (was.active !== rule.active) entries.push({ ...base, action: rule.active ? 'resume' : 'pause' });
      if (was.id !== rule.id) entries.push({ ...base, action: 'renumber', was: was.id });
      kept.push({ ...rule, key: was.key });
    }
    for (const r of gone) removed.push({ level, name, rule: r });
    if (last.name !== name) changed = true;
    known.docs[key] = { name, rules: kept };
    if (pairs.some((p) => !p.was || p.was.text !== p.rule.text || p.was.id !== p.rule.id || p.was.active !== p.rule.active) || gone.length) {
      changed = true;
    }
  }
  for (const add of added) {
    const from = removed.findIndex((r) => r.rule.text === add.rule.text && r.name !== add.name);
    let key;
    if (from !== -1) {
      const [rem] = removed.splice(from, 1);
      key = rem.rule.key;
      entries.push({ at, action: 'move', level: add.level, where: add.name, id: add.rule.id, text: add.rule.text, rule: key, was: rem.rule.id, from: rem.name });
    } else {
      key = known.next++;
      entries.push({ at, action: 'add', level: add.level, where: add.name, id: add.rule.id, text: add.rule.text, rule: key });
    }
    add.holder[add.index] = { ...add.rule, key };
  }
  for (const rem of removed) {
    entries.unshift({ at, action: 'remove', level: rem.level, where: rem.name, id: rem.rule.id, text: rem.rule.text, rule: rem.rule.key });
  }
  if (!changed && !entries.length) return entries;
  fs.mkdirSync(where.home, { recursive: true });
  if (entries.length) fs.appendFileSync(path.join(where.home, LOG), entries.map((e) => `${JSON.stringify(e)}\n`).join(''));
  const file = path.join(where.home, STATE);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(known));
  try {
    fs.renameSync(temp, file);
  } catch {
    fs.rmSync(temp, { force: true });
    fs.writeFileSync(file, JSON.stringify(known));
  }
  return entries;
}

function readLog(home) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(home, LOG), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A half-written line from a crash: skip it.
    }
  }
  return out;
}

function when(at) {
  const d = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function describe(e) {
  switch (e.action) {
    case 'add': return `added ${e.id}: ${e.text}`;
    case 'remove': return `removed ${e.id}: ${e.text}`;
    case 'edit': return `edited ${e.id}: ${e.text} (was: ${e.before})`;
    case 'pause': return `paused ${e.id}: ${e.text}`;
    case 'resume': return `resumed ${e.id}: ${e.text}`;
    case 'renumber': return `${e.was} is now ${e.id}: ${e.text}`;
    case 'move': return `moved ${e.was} from ${e.from}, now ${e.id}: ${e.text}`;
    default: return `${e.id}: ${e.text}`;
  }
}

// The latest changes, newest last.
function recentText(home, { limit = 30 } = {}) {
  const log = readLog(home);
  const changes = log.filter((e) => e.action !== 'listed');
  const start = log.length ? `History starts ${when(log[0].at)}.` : 'No history yet.';
  if (!changes.length) return `${start} No changes recorded since.`;
  const shown = changes.slice(-limit);
  const out = [`${start} ${changes.length > shown.length ? `Latest ${shown.length} of ${changes.length} changes:` : 'Changes:'}`];
  for (const e of shown) out.push(`${when(e.at)}  ${e.where}  ${describe(e)}`);
  return out.join('\n');
}

// Every rule that has had `id` at this level, with when, and what it is now.
// `where` names the chat's project and chat for PR and CR numbers.
function idText(home, where, id) {
  const level = { G: 'global', P: 'project', C: 'chat' }[id[0]];
  const name = docName(where, level);
  const log = readLog(home);
  if (!log.length) return 'No history yet: it starts the next time CC Rules reads the rules files.';
  const rules = new Map(); // key -> { id, where, text, gone }
  const periods = [];
  const open = new Map(); // key -> period while it holds the ID here
  for (const e of log) {
    const now = rules.get(e.rule) || {};
    const next = e.action === 'remove'
      ? { ...now, gone: e.at, text: e.text, id: e.id, where: e.where }
      : { id: e.id, where: e.where, text: e.text, gone: null };
    rules.set(e.rule, next);
    const holds = !next.gone && next.id === id && next.where === name;
    const period = open.get(e.rule);
    if (holds && !period) {
      const p = { rule: e.rule, from: e.action === 'listed' ? null : e.at, text: e.text, was: e.was, until: null };
      periods.push(p);
      open.set(e.rule, p);
    } else if (!holds && period) {
      period.until = e.at;
      open.delete(e.rule);
    } else if (holds && period) {
      period.text = e.text;
    }
  }
  if (!periods.length) return `${id} hasn't been used in ${name} since history started (${when(log[0].at)}).`;
  const out = [`${id} in ${name}:`];
  for (const p of periods) {
    const span = `${p.from ? `from ${when(p.from)}` : `from the start of history (${when(log[0].at)})`}${p.until ? ` until ${when(p.until)}` : ' to now'}`;
    out.push(`- ${span}: "${p.text}"${p.from && p.was ? ` (it was ${p.was} before)` : ''}`);
    if (p.until) {
      const now = rules.get(p.rule);
      out.push(now.gone ? `  Removed ${when(now.gone)}.` : `  Now ${now.id} in ${now.where}: "${now.text}"`);
    }
  }
  return out.join('\n');
}

module.exports = { record, recentText, idText, readLog };
