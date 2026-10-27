'use strict';
// CC Rules core: reads, checks and rewrites the rule files for a chat's
// three levels (where.js says where each file lives):
//
//   global   every chat              highest: wins any conflict
//   project  every chat in a project
//   chat     this chat only          lowest
//
// Each rule is one checklist line with an ID that is never reused:
//   - [x] R3: Always answer in plain English     ([x] active, [ ] paused)
//
// Every load reads the files fresh from disk, so hand edits are always seen.
// Project and chat files carry a "Linked to ..." line with the group's or
// chat's ID; a load renames them to match the current name, so the rules
// follow a rename. Rewrites change only the lines they must.

const fs = require('node:fs');
const path = require('node:path');
const { RulesError, checkSessionId } = require('./where');

const LEVELS = ['global', 'project', 'chat']; // highest first
const GLOBAL_FILE = 'GLOBAL.md';
const FOLDER_FILE = path.join('.claude', 'cc-rules', 'PROJECT.md');
const NEXT_ID_FILE = '.next-id';
const HEADINGS = { global: '# Global rules', project: '# Project rules', chat: '# Chat rules' };

// "- [x] R3: text" -> indent, bullet, box, rest. "[]" counts as unchecked.
const CHECKLIST_RE = /^(\s*)([-*+])\s+\[([ xX]?)\]\s*(.*)$/;
// "R3:" at the start of the rest. Also accepts "R3 -", "R3.", "R3)" and "r3".
const ID_RE = /^[Rr](\d+)\b[ \t]*[:.)–—-]?[ \t]*/;
const BULLET_RE = /^\s*[-*+]\s+\S/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const LINK_RE = /^Linked to (chat|project) (\S+?)\.?(?=\s|$)/m;

// --- Parsing ---------------------------------------------------------------

// Splits a rules file into lines and finds the rule lines. Lines inside code
// fences and HTML comments are never rules. Bullets that aren't checklist
// lines are reported, since they are usually a rule missing its box.
function parse(text) {
  const bom = text.startsWith('﻿');
  if (bom) text = text.slice(1);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const { rules, skipped } = scan(lines);
  return { bom, eol, lines, rules, skipped };
}

function scan(lines) {
  const rules = [];
  const skipped = [];
  let fence = null;
  let inComment = false;
  lines.forEach((line, index) => {
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      return;
    }
    const fenceMatch = FENCE_RE.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      return;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      return;
    }
    if (/^\s*<!--/.test(line)) {
      if (!line.includes('-->')) inComment = true;
      return;
    }
    const m = CHECKLIST_RE.exec(line);
    if (m) {
      const [, indent, bullet, box, rest] = m;
      const idMatch = ID_RE.exec(rest);
      const text = (idMatch ? rest.slice(idMatch[0].length) : rest).trim();
      if (!text) return;
      rules.push({
        id: idMatch ? `R${Number(idMatch[1])}` : null,
        active: box.toLowerCase() === 'x',
        text,
        index,
        indent,
        bullet,
      });
      return;
    }
    if (BULLET_RE.test(line)) skipped.push({ index, text: line.trim() });
  });
  return { rules, skipped };
}

function ruleLine(rule) {
  return `${rule.indent || ''}${rule.bullet || '-'} [${rule.active ? 'x' : ' '}] ${rule.id}: ${rule.text}`;
}

function idNumber(id) {
  return Number(id.slice(1));
}

function highestId(rules) {
  return rules.reduce((max, rule) => (rule.id ? Math.max(max, idNumber(rule.id)) : max), 0);
}

// The group or chat ID on a file's "Linked to ..." line, if it has one.
function linkedId(text, kind) {
  const m = LINK_RE.exec(text);
  return m && m[1] === kind ? m[2] : null;
}

// --- Files -----------------------------------------------------------------

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function readRuleFile(file, level, label) {
  const text = readText(file);
  return { file, level, label, exists: text !== null, ...parse(text ?? '') };
}

function rescan(doc) {
  Object.assign(doc, scan(doc.lines));
}

// Writes to a temp file and renames it over the original, so a crash never
// leaves half a file. Falls back to a plain write if Windows refuses the rename.
function save(doc) {
  fs.mkdirSync(path.dirname(doc.file), { recursive: true });
  const text = (doc.bom ? '﻿' : '') + doc.lines.join(doc.eol);
  const temp = `${doc.file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text, 'utf8');
    fs.renameSync(temp, doc.file);
  } catch {
    fs.rmSync(temp, { force: true });
    fs.writeFileSync(doc.file, text, 'utf8');
  }
  doc.exists = true;
}

// Saves, or notes why it couldn't. Used for tidy-ups during a load, which
// must never stop the rules loading.
function trySave(state, doc) {
  try {
    save(doc);
  } catch (err) {
    state.notices.push(`Couldn't save ${path.basename(doc.file)}: ${err.message}`);
  }
}

function slash(file) {
  return file.split(path.sep).join('/');
}

// A safe file name for a group or chat name, on any system.
function fileName(name) {
  let base = String(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  if (!base) base = 'Untitled';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base += ' rules';
  return base;
}

function samePath(a, b) {
  const caseless = process.platform === 'win32' || process.platform === 'darwin';
  const norm = (p) => (caseless ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
}

// <dir>/<base>.md, or "<base> (2).md" and so on when another file has the
// name. `own` is the file being renamed, which doesn't count as taken.
function freePath(dir, base, own) {
  for (let n = 1; ; n++) {
    const file = path.join(dir, `${base}${n === 1 ? '' : ` (${n})`}.md`);
    if ((own && samePath(file, own)) || !fs.existsSync(file)) return file;
  }
}

// True when the file is already named for `base`: "Base.md" or "Base (2).md".
function namedFor(file, base) {
  const name = path.basename(file, '.md');
  return name === base || (name.startsWith(`${base} (`) && /^ \(\d+\)$/.test(name.slice(base.length)));
}

// The file in `dir` linked to this group or chat. Tries `hint` (where it
// was last time) before reading the folder.
function findLinked(dir, kind, id, hint) {
  const files = [];
  if (hint && samePath(path.dirname(hint), dir)) files.push(hint);
  let names = [];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    // No folder yet, so no file.
  }
  for (const name of names) if (name.endsWith('.md')) files.push(path.join(dir, name));
  for (const file of files) {
    let text = null;
    try {
      text = readText(file);
    } catch {
      // Unreadable: can't be ours.
    }
    if (text !== null && linkedId(text, kind) === id) return file;
  }
  return null;
}

function linkLine(kind, id) {
  return `Linked to ${kind} ${id}. Keep this line: it ties the file to the ${kind}, even after renames.`;
}

function chatName(where) {
  return where.chatTitle || `Untitled chat ${where.sessionId.slice(0, 8)}`;
}

// Starting text for a file that doesn't exist yet.
function starterLines(doc, where) {
  const howTo = [
    'One rule per checklist line: `[x]` = active, `[ ]` = paused. Edit by hand any time;',
    'Claude re-reads this file before changing it.',
  ];
  if (doc.level === 'global') {
    return [HEADINGS.global, '', 'Rules for every chat, in every project. They outrank project and chat rules.', ...howTo, ''];
  }
  if (doc.level === 'project') {
    const { project } = where;
    const scope =
      project.kind === 'group'
        ? `Rules for every chat in the "${project.name}" sidebar group.`
        : "Rules for every chat in this folder that isn't filed in a sidebar group.";
    const lines = [`${HEADINGS.project}: ${project.name}`, '', scope, 'They outrank chat rules; global rules outrank them.', ...howTo];
    if (project.kind === 'group') lines.push(linkLine('project', project.id));
    return [...lines, ''];
  }
  return [
    `${HEADINGS.chat}: ${doc.name || chatName(where)}`,
    '',
    'Rules for this chat only. Global and project rules outrank them.',
    ...howTo,
    linkLine('chat', where.sessionId),
    '',
  ];
}

// --- State -----------------------------------------------------------------

function projectLabel(where) {
  return `project "${where.project.name}"`;
}

// Opens the file linked to a group or chat. If there's none, a file with the
// right name but no "Linked to" line (say, one the user made by hand) is
// adopted and linked; otherwise the doc is for a new file with a free name.
function openLinked(state, dir, kind, id, name, hint, level, label) {
  const linked = findLinked(dir, kind, id, hint);
  if (linked) return readRuleFile(linked, level, label);
  const named = path.join(dir, `${fileName(name)}.md`);
  const text = readText(named);
  if (text !== null && !LINK_RE.test(text)) {
    const doc = readRuleFile(named, level, label);
    const at = doc.lines[0] && doc.lines[0].startsWith('#') ? 1 : 0;
    doc.lines.splice(at, 0, linkLine(kind, id));
    rescan(doc);
    trySave(state, doc);
    state.notices.push(`Linked ${path.basename(named)} to ${label}.`);
    return doc;
  }
  return readRuleFile(freePath(dir, fileName(name)), level, label);
}

function openDocs(state, hints) {
  const { where } = state;
  state.global = readRuleFile(path.join(where.home, GLOBAL_FILE), 'global', 'global rules');
  state.project =
    where.project.kind === 'group'
      ? openLinked(state, path.join(where.home, 'projects'), 'project', where.project.id, where.project.name,
          hints.projectFile, 'project', projectLabel(where))
      : readRuleFile(path.join(where.project.id, FOLDER_FILE), 'project', projectLabel(where));
  state.chat = where.sessionId
    ? openLinked(state, path.join(where.home, 'chats'), 'chat', where.sessionId, chatName(where),
        hints.chatFile, 'chat', 'this chat')
    : null;
}

// Reads the three files for a chat and tidies them:
// - a renamed group or chat gets its file and heading renamed to match
// - a rule the user added by hand without an ID gets the next free one
// - a repeated ID (say, from a copied line) is replaced on the lower copy
// What changed is listed in state.notices, with any warnings from `where`.
// `hints` are the file paths that matched last time, to save a folder scan.
function load(where, { hints = {} } = {}) {
  if (where.sessionId) checkSessionId(where.sessionId);
  const state = { where, notices: [...where.warnings], global: null, project: null, chat: null };
  openDocs(state, hints);
  syncNames(state);
  repair(state);
  return state;
}

function docs(state) {
  return [state.global, state.project, state.chat].filter(Boolean);
}

function allRules(state) {
  return docs(state).flatMap((doc) => doc.rules.map((rule) => ({ doc, rule })));
}

// Updates the first heading if it's one of ours and names something else.
function syncHeading(doc, name) {
  const first = doc.lines.findIndex((line) => line.trim() !== '');
  if (first === -1) return false;
  const want = `${HEADINGS[doc.level]}: ${name}`;
  const line = doc.lines[first];
  if (!line.startsWith(HEADINGS[doc.level]) || line === want) return false;
  doc.lines[first] = want;
  return true;
}

function renameTo(state, doc, base, what) {
  if (namedFor(doc.file, base)) return;
  const target = freePath(path.dirname(doc.file), base, doc.file);
  try {
    fs.renameSync(doc.file, target);
  } catch (err) {
    state.notices.push(`Couldn't rename the rules file for ${what}: ${err.message}`);
    return;
  }
  doc.file = target;
  state.notices.push(`Renamed the rules file for ${what} to match its name: ${path.basename(target)}`);
}

function syncNames(state) {
  const { where } = state;
  if (state.project.exists) {
    if (where.project.kind === 'group') renameTo(state, state.project, fileName(where.project.name), state.project.label);
    if (syncHeading(state.project, where.project.name)) trySave(state, state.project);
  }
  const chat = state.chat;
  if (chat && chat.exists && where.chatTitle) {
    renameTo(state, chat, fileName(where.chatTitle), 'this chat');
    if (syncHeading(chat, where.chatTitle)) trySave(state, chat);
  }
}

function fileLabel(doc) {
  return path.basename(doc.file);
}

function repair(state) {
  const seen = new Set();
  for (const doc of docs(state)) {
    let changed = false;
    for (const rule of doc.rules) {
      if (rule.id && !seen.has(rule.id)) {
        seen.add(rule.id);
        continue;
      }
      const oldId = rule.id;
      rule.id = allocateId(state);
      seen.add(rule.id);
      doc.lines[rule.index] = ruleLine(rule);
      changed = true;
      const where = `line ${rule.index + 1} of ${fileLabel(doc)}`;
      state.notices.push(
        oldId
          ? `${oldId} was used twice, so the copy on ${where} is now ${rule.id}: ${rule.text}`
          : `Gave the new rule on ${where} the ID ${rule.id}: ${rule.text}`,
      );
    }
    if (changed) trySave(state, doc);
  }
  for (const doc of docs(state)) {
    for (const line of doc.skipped) {
      state.notices.push(
        `Line ${line.index + 1} of ${fileLabel(doc)} isn't a checklist line, so it isn't a rule: ${line.text}`,
      );
    }
  }
}

function highestIdInDir(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let max = 0;
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    try {
      max = Math.max(max, highestId(parse(fs.readFileSync(path.join(dir, name), 'utf8')).rules));
    } catch {
      // An unreadable file can't hold an ID we'd clash with in practice.
    }
  }
  return max;
}

// IDs come from one counter for every level, project and chat on this
// machine, so a rule keeps its ID when it moves and an ID is never reused.
// The counter can't fall behind an ID that's already in a file.
function allocateId(state) {
  const { home } = state.where;
  const counterFile = path.join(home, NEXT_ID_FILE);
  let max = 0;
  for (const doc of docs(state)) max = Math.max(max, highestId(doc.rules));
  for (const sub of ['', 'projects', 'chats']) max = Math.max(max, highestIdInDir(path.join(home, sub)));
  const counter = parseInt(readText(counterFile) || '0', 10) || 0;
  const next = Math.max(counter, max + 1);
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(counterFile, `${next + 1}\n`);
  } catch {
    // The files themselves still keep IDs unique; the counter only stops reuse.
  }
  return `R${next}`;
}

function levelDoc(state, level) {
  if (level === 'global') return state.global;
  if (level === 'project') return state.project;
  if (level === 'chat') {
    if (!state.chat) {
      throw new RulesError("This chat's session ID is needed for chat rules (pass --session).");
    }
    return state.chat;
  }
  throw new RulesError(`Unknown level "${level}". Use global, project or chat.`);
}

function rank(doc) {
  return LEVELS.indexOf(doc.level);
}

function normaliseId(raw) {
  const m = /^\s*[Rr]?(\d+)\s*$/.exec(String(raw ?? ''));
  if (!m) throw new RulesError(`"${raw ?? ''}" isn't a rule ID. IDs look like R3.`);
  return `R${Number(m[1])}`;
}

function find(state, raw) {
  const id = normaliseId(raw);
  const hit = allRules(state).find(({ rule }) => rule.id === id);
  if (hit) return hit;
  const ids = allRules(state)
    .sort((a, b) => idNumber(a.rule.id) - idNumber(b.rule.id))
    .map(({ doc, rule }) => `${rule.id} (${doc.label})`);
  const known = ids.length ? `Rules are: ${ids.join(', ')}.` : 'There are no rules yet.';
  const chatNote = state.chat ? '' : " This chat's rules weren't checked (no session ID).";
  throw new RulesError(`There's no rule ${id}. ${known}${chatNote}`);
}

function cleanText(text) {
  const clean = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-*+]\s+\[[ xX]?\]\s*/, '');
  if (!clean) throw new RulesError('The rule text is empty.');
  return clean;
}

function sameText(a, b) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[\s.!]+$/, '').trim();
  return norm(a) === norm(b);
}

function insert(state, doc, rule) {
  if (!doc.exists && doc.lines.every((line) => line.trim() === '')) {
    doc.lines = starterLines(doc, state.where);
  }
  const line = ruleLine(rule);
  const last = doc.rules[doc.rules.length - 1];
  if (last) {
    doc.lines.splice(last.index + 1, 0, line);
  } else {
    while (doc.lines.length && doc.lines[doc.lines.length - 1].trim() === '') doc.lines.pop();
    if (doc.lines.length) doc.lines.push('');
    doc.lines.push(line, '');
  }
  rescan(doc);
}

// --- Changes ---------------------------------------------------------------
// Each returns the line to echo back to the user.

function created(doc, wasNew) {
  return wasNew ? `\nCreated ${slash(doc.file)}` : '';
}

function addRule(state, { level = 'chat', text, active = true, title } = {}) {
  const doc = levelDoc(state, level);
  text = cleanText(text);
  const twin = allRules(state).find(({ rule }) => sameText(rule.text, text));
  if (twin) return notAdded(twin, doc);
  const wasNew = !doc.exists;
  // A new chat file for a chat with no name yet can take Claude's suggestion.
  const name = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (wasNew && level === 'chat' && !state.where.chatTitle && name) {
    doc.name = name;
    doc.file = freePath(path.dirname(doc.file), fileName(name));
  }
  const rule = { id: allocateId(state), active, text };
  insert(state, doc, rule);
  save(doc);
  return `Added ${rule.id} to ${doc.label}${active ? '' : ' (paused)'}: ${text}${created(doc, wasNew)}`;
}

function notAdded({ doc, rule }, target) {
  const where = `${rule.id} in ${doc.label}`;
  const paused = rule.active ? '' : ` It's paused; resume it with: resume ${rule.id}`;
  if (doc === target) return `Not added: ${where} already says that.${paused}`;
  if (rank(doc) < rank(target)) {
    const reach = doc.level === 'global' ? 'global rules apply to every chat' : 'project rules apply to this chat';
    return `Not added: ${where} already says that, and ${reach}.${paused}`;
  }
  return `Not added: ${where} already says that. To make it apply more widely, move it: move ${rule.id} --to ${target.level}`;
}

function editRule(state, raw, text) {
  const { doc, rule } = find(state, raw);
  text = cleanText(text);
  if (rule.text === text) return `${rule.id} in ${doc.label} already says that. Nothing changed.`;
  const twin = allRules(state).find((x) => x.rule !== rule && sameText(x.rule.text, text));
  if (twin) return `Not changed: ${twin.rule.id} in ${twin.doc.label} already says that.`;
  const old = rule.text;
  rule.text = text;
  doc.lines[rule.index] = ruleLine(rule);
  save(doc);
  return `Edited ${rule.id} in ${doc.label}: ${text} (was: ${old})`;
}

function removeRule(state, raw) {
  const { doc, rule } = find(state, raw);
  doc.lines.splice(rule.index, 1);
  rescan(doc);
  save(doc);
  return `Removed ${rule.id} from ${doc.label}: ${rule.text}`;
}

// Takes rule `id` out of one rules file, wherever it is; for undoing a move
// into CC Rules. True if it was there.
function removeFromFile(file, id) {
  const doc = readRuleFile(file, null, '');
  const rule = doc.rules.find((r) => r.id === id);
  if (!rule) return false;
  doc.lines.splice(rule.index, 1);
  save(doc);
  return true;
}

function setActive(state, raw, active) {
  const { doc, rule } = find(state, raw);
  if (rule.active === active) {
    return `${rule.id} in ${doc.label} is already ${active ? 'active' : 'paused'}: ${rule.text}`;
  }
  rule.active = active;
  doc.lines[rule.index] = ruleLine(rule);
  save(doc);
  return `${active ? 'Resumed' : 'Paused'} ${rule.id} in ${doc.label}: ${rule.text}`;
}

function moveEffect(from, to) {
  if (to.level === 'global') return 'Every chat now gets it.';
  if (to.level === 'chat') return 'Only this chat gets it now.';
  return from.level === 'global'
    ? `Only chats in ${to.label} get it now.`
    : `Every chat in ${to.label} now gets it.`;
}

function moveRule(state, raw, level) {
  const { doc: from, rule } = find(state, raw);
  const to = levelDoc(state, level);
  if (to === from) return `${rule.id} is already in ${to.label}: ${rule.text}`;
  from.lines.splice(rule.index, 1);
  rescan(from);
  const wasNew = !to.exists;
  insert(state, to, { id: rule.id, active: rule.active, text: rule.text });
  // Destination first: if the second write fails, the rule is in both files
  // and the next load renumbers the lower copy instead of losing it.
  save(to);
  save(from);
  const paused = rule.active ? '' : ' (paused)';
  return `Moved ${rule.id} from ${from.label} to ${to.label}${paused}: ${rule.text}\n${moveEffect(from, to)}${created(to, wasNew)}`;
}

// --- Views -----------------------------------------------------------------

function escapeCell(text) {
  return text.replace(/\|/g, '\\|');
}

function levelColumn(doc, where) {
  if (doc.level === 'project') return `project: ${escapeCell(where.project.name)}`;
  return doc.level === 'global' ? 'global' : 'this chat';
}

function fileLine(doc) {
  return `${slash(doc.file)}${doc.exists ? '' : ' (not created yet)'}`;
}

// Every rule with its ID, level and status, as a Markdown table, then where
// each level's file is.
function listText(state) {
  const { where } = state;
  const rows = allRules(state);
  const out = [];
  if (rows.length) {
    out.push('| ID | Level | Status | Rule |', '| --- | --- | --- | --- |');
    for (const { doc, rule } of rows) {
      out.push(`| ${rule.id} | ${levelColumn(doc, where)} | ${rule.active ? 'active' : 'paused'} | ${escapeCell(rule.text)} |`);
    }
  } else {
    out.push('No rules yet. Say "make a rule for this chat: ...", "...for this project: ..." or "...for every chat: ...".');
  }
  const kind = where.project.kind === 'group' ? 'sidebar group' : 'folder, not in a sidebar group';
  out.push('');
  out.push(`Global rules: ${fileLine(state.global)}`);
  out.push(`Project "${where.project.name}" (${kind}): ${fileLine(state.project)}`);
  if (state.chat) {
    const name = where.chatTitle ? ` "${where.chatTitle}"` : '';
    out.push(`This chat${name}: ${fileLine(state.chat)}`);
  } else {
    out.push("This chat's rules: not shown (no session ID given)");
  }
  out.push('If rules conflict, the higher level wins: global, then project, then this chat.');
  for (const notice of state.notices) out.push(`Note: ${notice}`);
  return out.join('\n');
}

function shorten(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const SHORT_LEVEL = { global: 'global', project: 'project', chat: 'this chat' };

// The short list shown to the user when a chat starts.
function summaryText(state, { maxRules = 8, maxLength = 70 } = {}) {
  const rows = allRules(state);
  const active = rows.filter(({ rule }) => rule.active);
  const paused = rows.length - active.length;
  const out = [];
  if (active.length) {
    out.push(`CC Rules: ${active.length} active`);
    for (const { doc, rule } of active.slice(0, maxRules)) {
      out.push(`  ${rule.id} (${SHORT_LEVEL[doc.level]}) ${shorten(rule.text, maxLength)}`);
    }
    if (active.length > maxRules) out.push(`  …and ${active.length - maxRules} more`);
  } else {
    out.push('CC Rules: no active rules.');
  }
  const tail = [];
  if (paused) tail.push(`${paused} paused`);
  tail.push(`project: ${state.where.project.name}`);
  tail.push('/rules to see or change them');
  out.push(tail.join(' · '));
  for (const notice of state.notices) out.push(`Note: ${notice}`);
  return out.join('\n');
}

// The rules as data, for the CC Rules panel. `watch` lists the files whose
// changes can change what the panel shows.
function viewData(state) {
  const { where } = state;
  const level = (doc) => ({
    level: doc.level,
    label: doc.label,
    file: slash(doc.file),
    exists: doc.exists,
    rules: doc.rules.map((rule) => ({ id: rule.id, active: rule.active, text: rule.text })),
  });
  return {
    project: { kind: where.project.kind, name: where.project.name },
    chatTitle: where.chatTitle,
    levels: docs(state).map(level),
    notices: state.notices,
    watch: [...docs(state).map((doc) => doc.file), where.desktopRecord, where.desktopConfig]
      .filter(Boolean)
      .map(slash),
  };
}

// What Claude is told about the rules.
function contextText(state, commandPrefix) {
  const { where } = state;
  const rows = allRules(state);
  const active = rows.filter(({ rule }) => rule.active);
  const paused = rows.filter(({ rule }) => !rule.active);
  const out = ['# CC Rules', ''];
  out.push(
    'The user keeps visible, editable rules for their chats in Markdown files, at three levels:',
    'global (every chat), project (every chat in this project) and chat (this chat only).',
    'Follow every active rule below for the whole chat. Do not follow paused rules.',
    'If two rules conflict, the higher level wins: global over project, project over this chat.',
    '',
  );
  if (active.length) {
    out.push('Active rules:');
    for (const { doc, rule } of active) out.push(`- ${rule.id} (${doc.label}): ${rule.text}`);
  } else {
    out.push('There are no active rules yet.');
  }
  if (paused.length) out.push('', `Paused, do not follow: ${paused.map(({ rule }) => rule.id).join(', ')}`);
  const kind = where.project.kind === 'group' ? 'the sidebar group this chat is filed under' : 'this chat\'s folder; the chat is in no sidebar group';
  out.push('', 'Files:');
  out.push(`- global: ${slash(state.global.file)}`);
  out.push(`- project "${where.project.name}" (${kind}): ${slash(state.project.file)}`);
  if (state.chat) out.push(`- this chat: ${slash(state.chat.file)}`);
  out.push(
    '',
    'To show or change rules, use the cc-rules `rules` skill (/rules). Use it whenever the user says',
    '"make a rule for this chat" (level: chat), "...for this project" (level: project) or "...for every',
    'chat" / "...global rule" (level: global), or asks to list, add, edit, remove, pause, resume or move',
    'a rule, or to reload the rules.',
  );
  if (commandPrefix) out.push('Its command line for this chat is:', `  ${commandPrefix} <command> ...`);
  if (state.notices.length) {
    out.push('', 'Changes made while loading (the user was shown these):');
    for (const notice of state.notices) out.push(`- ${notice}`);
  }
  return out.join('\n');
}

module.exports = {
  parse,
  load,
  allRules,
  fileName,
  addRule,
  editRule,
  removeRule,
  removeFromFile,
  setActive,
  moveRule,
  listText,
  summaryText,
  contextText,
  viewData,
};
