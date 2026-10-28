'use strict';
// Finds rules that live outside CC Rules, so they can be moved into it or
// cleaned out. It looks where Claude Code reads instructions from, and where
// people tend to park rules:
//
//   ~/.claude/CLAUDE.md, ~/.claude/rules/**/*.md        Claude Code's own global instructions
//   ~/.claude/projects/*/memory/*.md (type: feedback)   lessons Claude saved in its memory
//   CLAUDE.md, CLAUDE.local.md, .claude/CLAUDE.md, AGENTS.md, .claude/rules/**/*.md
//       in the chat's folder, the folders above it, and folders below it
//   Markdown files with "rules" in the name, in and below the chat's folder
//   old Chat Rules files (~/.claude/chat-rules, <folder>/.claude/chat-rules)
//
// In rules files every list item counts as a rule. In mixed files such as
// CLAUDE.md, only lines that read as instructions do ("Never...", "Always
// ...", "Ask before..."), so notes about how a program works stay out.
//
// Every change backs up the files it touches to <home>/.backups/<time>/ first;
// undo puts the latest change back.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { RulesError, claudeDir } = require('./where');
const { parse } = require('./rulebook');

const INSTRUCTION_FILES = ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md'), 'AGENTS.md'];
const DEPTH = 3;
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.gradle', '.next', '.venv', 'venv', '__pycache__', '.cache', '.idea', '.vs',
  '.vscode', 'dist', 'build', 'out', 'release', 'bin', 'obj', 'target', 'vendor', 'coverage', 'build-tools',
]);

const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]?\]\s*)?(.*)$/;
const IMPERATIVE_RE =
  /^(always|never|don'?t|do not|avoid|prefer|use|keep|make|ask|show|write|follow|build|check|verify|say|plan|finish|put|run|test|screenshot|flag|stop|wait|tell|explain|answer|reply|respond|commit|push|treat|leave|include|exclude|only|be|stay|match|mention|confirm|report|limit|give|update|start|end|name|call|send|open|close)\b/i;
const MODAL_RE =
  /\b(always|never|must|mustn'?t|should|shouldn'?t|don'?t|do not|avoid|make sure|unless (?:asked|told)|without asking|ask (?:first|before)|wait for)\b/i;

// --- What counts as a rule -------------------------------------------------

function cleanText(text) {
  return text
    .replace(/^[GgPpCc]?[Rr]\d+\s*[:.)-]\s*/, '') // a CC Rules or old Chat Rules ID
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ruleLike(text) {
  // "Tone: plain and direct" reads as an instruction once its label is set aside.
  const body = text.replace(/^[A-Z][\w /'-]{0,30}:\s+/, '');
  return IMPERATIVE_RE.test(body) || MODAL_RE.test(text);
}

// In a mixed file such as CLAUDE.md, notes on how the program works say
// "never" and "must" too. A rule there is short, and isn't under a heading
// for that kind of knowledge.
const KNOWLEDGE_RE =
  /learn|lesson|gotcha|history|changelog|architecture|how (it|a|an|the|to build)|put together|reference|commands?|\bapi\b|schema|data model|release|validation|checklist|troubleshoot|known issues|worth considering|ideas|next steps|trace|connector|install/i;
const MIXED_MAX = 180;

function mixedRule(block) {
  return block.text.length <= MIXED_MAX && !(block.section && KNOWLEDGE_RE.test(block.section)) && ruleLike(block.text);
}

function usable(text) {
  return text.length >= 12 && !/^(\[[^\]]*\]\([^)]*\)|`[^`]*`|https?:\S+)$/.test(text);
}

// Rule candidates in one Markdown file: list items and paragraphs, each with
// the lines it spans and the heading it sits under.
function blocks(text) {
  const lines = text.split(/\r?\n/);
  const found = [];
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) start = end + 1;
  }
  let fence = null;
  let inComment = false;
  let section = null;
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      i++;
      continue;
    }
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0]) fence = null;
      i++;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      i++;
      continue;
    }
    if (/^\s*<!--/.test(line)) {
      if (!line.includes('-->')) inComment = true;
      i++;
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      section = cleanText(heading[1]);
      i++;
      continue;
    }
    if (!line.trim() || /^\s*\|/.test(line) || /^\s*(---|\*\*\*|>)/.test(line)) {
      i++;
      continue;
    }
    const list = LIST_RE.exec(line);
    let end = i;
    let body;
    if (list) {
      // A list item runs on over its more-indented continuation lines.
      body = [list[2]];
      while (end + 1 < lines.length) {
        const next = lines[end + 1];
        if (!next.trim() || LIST_RE.test(next) || !/^\s/.test(next) || next.search(/\S/) <= list[1].length) break;
        body.push(next.trim());
        end++;
      }
    } else {
      // A paragraph runs until a blank line or something that isn't prose.
      body = [line.trim()];
      while (end + 1 < lines.length) {
        const next = lines[end + 1];
        if (!next.trim() || LIST_RE.test(next) || /^\s*(#|\||```|~~~|<!--|>)/.test(next)) break;
        body.push(next.trim());
        end++;
      }
    }
    found.push({ start: i, end, isList: Boolean(list), section, text: cleanText(body.join(' ')) });
    i = end + 1;
  }
  return found;
}

// Lessons Claude saved in its memory: one rule per file of type "feedback".
function memoryRule(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m || !/^\s*type:\s*feedback\s*$/m.test(m[1])) return null;
  const description = /^description:\s*"?(.*?)"?\s*$/m.exec(m[1]);
  const lead = m[2].split(/\r?\n\s*\r?\n|\*\*Why:\*\*/)[0];
  const rule = cleanText(lead.replace(/\r?\n/g, ' ')) || (description ? cleanText(description[1]) : '');
  return rule ? rule.replace(/\[\[([^\]]+)\]\]/g, '$1') : null;
}

// --- Where to look -----------------------------------------------------------

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function markdownUnder(dir) {
  return listDir(dir).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownUnder(full);
    return entry.name.toLowerCase().endsWith('.md') ? [full] : [];
  });
}

function slash(file) {
  return file.split(path.sep).join('/');
}

// Claude Code names a project's memory folder after its path, every other
// character a dash: C:\Users\me\Desktop\My Programs -> C--Users-me-Desktop-My-Programs.
function encodePath(dir) {
  return path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-');
}

// Every file worth reading, with what kind it is and how to describe it.
// CC Rules' own folder-project files met on the way go into `ccFiles`.
function places(where, env, ccFiles = []) {
  const root = where.cwd;
  const claude = claudeDir(env);
  const own = [path.resolve(where.home), path.resolve(root, '.claude', 'cc-rules')].map((p) => p.toLowerCase());
  const isOwn = (file) => own.some((dir) => path.resolve(file).toLowerCase().startsWith(dir + path.sep));
  const label = (file) => {
    const rel = path.relative(root, file);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return slash(rel);
    const fromClaude = path.relative(claude, file);
    if (!fromClaude.startsWith('..')) return `~/.claude/${slash(fromClaude)}`;
    return slash(file);
  };
  const out = new Map();
  const add = (file, kind, extra = {}) => {
    if (!isOwn(file) && isFile(file)) {
      out.set(path.resolve(file).toLowerCase(), { file, kind, label: extra.label || label(file), ...extra });
    }
  };
  const addInstructions = (dir, kind) => {
    for (const name of INSTRUCTION_FILES) add(path.join(dir, name), kind);
    for (const file of markdownUnder(path.join(dir, '.claude', 'rules'))) add(file, 'rules');
    const folderRules = path.join(dir, '.claude', 'cc-rules', 'PROJECT.md');
    if (isFile(folderRules)) ccFiles.push(folderRules);
  };

  // Claude Code's global instructions: rules found there suggest Global.
  add(path.join(claude, 'CLAUDE.md'), 'mixed', { user: true });
  for (const file of markdownUnder(path.join(claude, 'rules'))) add(file, 'rules', { user: true });
  // This folder and every folder above it.
  for (let dir = root; ; dir = path.dirname(dir)) {
    addInstructions(dir, 'mixed');
    if (path.dirname(dir) === dir) break;
  }
  // Folders below this one.
  const walk = (dir, depth) => {
    for (const entry of listDir(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // A folder's .claude is read with the folder itself (addInstructions).
        if (depth < DEPTH && !SKIP_DIRS.has(entry.name) && entry.name !== '.claude') {
          addInstructions(full, 'mixed');
          walk(full, depth + 1);
        }
      } else if (/rules[^/\\]*\.md$/i.test(entry.name) && depth > 0) {
        add(full, 'rules');
      }
    }
  };
  walk(root, 0);
  for (const entry of listDir(root)) {
    if (entry.isFile() && /rules[^/\\]*\.md$/i.test(entry.name)) add(path.join(root, entry.name), 'rules');
  }
  // Old Chat Rules files.
  for (const dir of [path.join(claude, 'chat-rules'), path.join(root, '.claude', 'chat-rules')]) {
    for (const file of markdownUnder(dir)) add(file, 'rules');
  }
  // Claude's memory, for every project.
  const projects = path.join(claude, 'projects');
  const rootCode = encodePath(root);
  for (const entry of listDir(projects)) {
    if (!entry.isDirectory()) continue;
    const memory = path.join(projects, entry.name, 'memory');
    let project = entry.name;
    if (entry.name === rootCode) project = path.basename(root);
    else if (entry.name.startsWith(`${rootCode}-`)) project = entry.name.slice(rootCode.length + 1);
    for (const e of listDir(memory)) {
      if (e.isFile() && e.name.endsWith('.md') && e.name !== 'MEMORY.md') {
        // The chat folder's own memory names no particular program.
        const names = entry.name === rootCode ? [] : [project];
        add(path.join(memory, e.name), 'memory', { label: `Claude's memory (${project}): ${e.name}`, names });
      }
    }
  }
  return [...out.values()];
}

// --- Rules CC Rules already has ----------------------------------------------

function normalise(text) {
  return cleanText(text).toLowerCase().replace(/[\s.!]+$/, '');
}

// The text of every rule in CC Rules: the rules home (global, every project
// and every chat) and folder-project files. Backups and state don't count.
function assignedTexts(where, ccFiles) {
  const files = [...ccFiles];
  for (const sub of ['', 'projects', 'chats']) {
    for (const entry of listDir(path.join(where.home, sub))) {
      if (entry.isFile() && entry.name.endsWith('.md')) files.push(path.join(where.home, sub, entry.name));
    }
  }
  const texts = new Set();
  for (const file of files) {
    try {
      for (const rule of parse(fs.readFileSync(file, 'utf8')).rules) texts.add(normalise(rule.text));
    } catch {
      // Unreadable: nothing to match against.
    }
  }
  return texts;
}

// --- Where a rule belongs --------------------------------------------------------

function squash(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// What a rule's place says about where it belongs: Global, for one in your
// own ~/.claude or under a "Global" heading; the program it names, for one
// under "Project: X" or in a program's folder or memory.
function hints(item, root) {
  const names = [...(item.names || [])];
  let global = Boolean(item.user);
  if (item.section) {
    if (/^global\b|every chat/i.test(item.section)) global = true;
    // "Project: A and B (same wording)" names A and B.
    const m = /^projects?\s*:\s*(.+)$/i.exec(item.section.replace(/\s*\([^)]*\)/g, ''));
    if (m) names.push(...m[1].split(/\s*(?:,|&|\band\b|\/)\s*/i).filter(Boolean));
  }
  if (item.place === 'mixed' && !item.user) {
    let dir = path.dirname(item.file);
    if (path.basename(dir) === '.claude') dir = path.dirname(dir);
    const rel = path.relative(root, dir);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) names.push(path.basename(dir));
  }
  return { global, names };
}

// Letters to change to turn one word into the other.
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

// How well a chat matches a program's name: 3 its name or folder is the
// program's, 2 its name starts with it, 1 one contains the other or a long
// name is off by a letter or two (a typo), 0 no match.
function closeness(name, chat, root) {
  const n = squash(name);
  if (n.length < 3) return 0;
  const title = squash(chat.title);
  const ownFolder = chat.cwd && path.resolve(chat.cwd).toLowerCase() !== path.resolve(root).toLowerCase();
  const folder = ownFolder ? squash(path.basename(chat.cwd)) : '';
  if (title === n || folder === n) return 3;
  if (n.length >= 4 && title.startsWith(n)) return 2;
  if ((n.length >= 5 && title.includes(n)) || (title.length >= 6 && n.includes(title)) || (folder.length >= 6 && n.includes(folder))) {
    return 1;
  }
  if (n.length >= 8 && distance(n, title.slice(0, n.length + 2)) <= 2) return 1;
  return 0;
}

// Suggestions for one rule: whether it looks global, and, for each program
// it names, the chats that match that name best (newest first) and their
// sidebar groups; at most 3 chats in all. `chats` comes from
// desktop.chats(); this chat is left out.
function suggest(item, where, chats) {
  const { global, names } = hints(item, where.cwd);
  const others = chats.filter((chat) => chat.sessionId !== where.sessionId);
  const matched = [];
  for (const name of names) {
    const scored = others.map((chat) => ({ chat, score: closeness(name, chat, where.cwd) }));
    const best = Math.max(0, ...scored.map((s) => s.score));
    for (const { chat, score } of scored) {
      if (best && score === best && !matched.includes(chat)) matched.push(chat);
    }
  }
  const groups = [];
  for (const chat of matched) {
    if (chat.group && !groups.some((g) => g.id === chat.group.id)) groups.push(chat.group);
  }
  return { global, groups, chats: matched.slice(0, 3).map((c) => ({ sessionId: c.sessionId, title: c.title })) };
}

// --- Scanning ------------------------------------------------------------------

function itemId(file, raw) {
  const hash = crypto.createHash('sha1').update(`${path.resolve(file).toLowerCase()}\n${raw}`).digest('hex');
  return `H${hash.slice(0, 6)}`;
}

function itemsIn(place) {
  let text;
  try {
    text = fs.readFileSync(place.file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return [];
  }
  // What the file says about where its rules belong (see hints).
  const from = { file: place.file, label: place.label, place: place.kind, user: Boolean(place.user), names: place.names || [] };
  if (place.kind === 'memory') {
    const rule = memoryRule(text);
    return rule ? [{ ...from, id: itemId(place.file, text), kind: 'memory', line: 1, section: null, text: rule }] : [];
  }
  const lines = text.split(/\r?\n/);
  return blocks(text)
    .filter((b) => usable(b.text) && (place.kind === 'rules' ? b.isList || ruleLike(b.text) : mixedRule(b)))
    .map((b) => {
      const raw = lines.slice(b.start, b.end + 1).join('\n');
      return { ...from, id: itemId(place.file, raw), kind: 'line', line: b.start + 1, lines: b.end - b.start + 1, raw, section: b.section, text: b.text };
    });
}

function ignoredFile(home) {
  return path.join(home, '.ignored.json');
}

function readIgnored(home) {
  try {
    return new Set(JSON.parse(fs.readFileSync(ignoredFile(home), 'utf8')).ids);
  } catch {
    return new Set();
  }
}

// Every rule found outside CC Rules. Not listed: rules CC Rules already has
// (`assigned` counts them) and rules the person chose to keep where they are
// (`ignored`).
function scan(where, env = process.env) {
  const ignored = readIgnored(where.home);
  const ccFiles = [];
  const all = places(where, env, ccFiles).flatMap(itemsIn);
  const has = assignedTexts(where, ccFiles);
  const fresh = all.filter((item) => !has.has(normalise(item.text)));
  const items = fresh.filter((item) => !ignored.has(item.id));
  return { items, assigned: all.length - fresh.length, ignored: fresh.length - items.length };
}

function find(where, env, id) {
  const item = places(where, env)
    .flatMap(itemsIn)
    .find((x) => x.id === String(id).trim());
  if (!item) throw new RulesError(`No hidden rule ${id}: its file changed or it's gone. Scan again.`);
  return item;
}

// --- Changing the source files --------------------------------------------------

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\..*/, '') + `-${process.pid}`;
}

// A change's backup folder: copies of each file before it changes, and what
// the change was, so undo can put it back.
function startBackup(home, change) {
  const dir = path.join(home, '.backups', stamp());
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { ...change, when: new Date().toISOString(), files: [] };
  return {
    dir,
    manifest,
    keep(file) {
      const copy = `${manifest.files.length + 1}-${path.basename(file)}`;
      fs.copyFileSync(file, path.join(dir, copy));
      manifest.files.push({ path: file, copy });
    },
    finish(extra = {}) {
      Object.assign(manifest, extra);
      fs.writeFileSync(path.join(dir, 'change.json'), JSON.stringify(manifest, null, 2));
    },
  };
}

function writeLines(file, lines, eol, bom) {
  fs.writeFileSync(file, (bom ? '\uFEFF' : '') + lines.join(eol), 'utf8');
}

// Takes the item out of its file. A memory note moves into the backup instead
// of being deleted, and its line in MEMORY.md goes too.
function takeOut(item, backup) {
  if (item.kind === 'memory') {
    backup.keep(item.file);
    const index = path.join(path.dirname(item.file), 'MEMORY.md');
    if (isFile(index)) {
      backup.keep(index);
      const text = fs.readFileSync(index, 'utf8');
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const name = path.basename(item.file);
      const kept = text.split(/\r?\n/).filter((line) => !line.includes(`(${name})`));
      writeLines(index, kept, eol, text.startsWith('\uFEFF'));
    }
    fs.rmSync(item.file);
    return;
  }
  backup.keep(item.file);
  const text = fs.readFileSync(item.file, 'utf8');
  const bom = text.startsWith('\uFEFF');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = (bom ? text.slice(1) : text).split(/\r?\n/);
  const at = item.line - 1;
  if (lines.slice(at, at + item.lines).join('\n') !== item.raw) {
    throw new RulesError(`${item.label} changed since the scan. Scan again.`);
  }
  lines.splice(at, item.lines);
  // Don't leave two blank lines where the rule was.
  if (at > 0 && at < lines.length && !lines[at - 1].trim() && !lines[at].trim()) lines.splice(at, 1);
  writeLines(item.file, lines, eol, bom);
}

function clean(where, env, id) {
  const item = find(where, env, id);
  const backup = startBackup(where.home, { action: 'remove', text: item.text, label: item.label });
  takeOut(item, backup);
  backup.finish();
  return `Removed from ${item.label}: ${item.text}\nA backup is kept; "undo" puts it back.`;
}

function keep(where, env, id) {
  const item = find(where, env, id);
  const ids = readIgnored(where.home);
  ids.add(item.id);
  fs.mkdirSync(where.home, { recursive: true });
  fs.writeFileSync(ignoredFile(where.home), JSON.stringify({ ids: [...ids] }, null, 2));
  return `Kept in ${item.label}, and it won't be listed again: ${item.text}`;
}

// Moves the item into CC Rules with `addRule` (given the item's text), then
// takes it out of its file. A rule CC Rules already has is only taken out.
function adopt(where, env, id, addRule) {
  const item = find(where, env, id);
  const added = addRule(item.text);
  const ruleId = /^Added ([GPC]R\d+) to /.exec(added.message);
  if (!ruleId && !/^Not added: [GPC]R\d+ in .* already says that/.test(added.message)) {
    throw new RulesError(added.message);
  }
  const backup = startBackup(where.home, { action: 'move', text: item.text, label: item.label });
  takeOut(item, backup);
  backup.finish(ruleId ? { ruleId: ruleId[1], ruleFile: added.file } : {});
  const first = added.message.split('\n')[0];
  return `${ruleId ? first : `Already in CC Rules: ${first.replace(/^Not added: /, '')}`}\nTook it out of ${item.label}. A backup is kept; "undo" puts it back.`;
}

// Puts back the latest change that hasn't been undone. `removeRule(file, text)`
// takes a moved rule back out of CC Rules (rulebook.removeFromFile).
function undo(where, removeRule) {
  const root = path.join(where.home, '.backups');
  const latest = listDir(root)
    .filter((e) => e.isDirectory() && !e.name.endsWith('.undone') && isFile(path.join(root, e.name, 'change.json')))
    .map((e) => e.name)
    .sort()
    .pop();
  if (!latest) throw new RulesError('Nothing to undo.');
  const dir = path.join(root, latest);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'change.json'), 'utf8'));
  for (const file of manifest.files) {
    fs.mkdirSync(path.dirname(file.path), { recursive: true });
    fs.copyFileSync(path.join(dir, file.copy), file.path);
  }
  let note = '';
  let renumbered = '';
  if (manifest.ruleId && manifest.ruleFile) {
    const out = removeRule(manifest.ruleFile, manifest.text);
    if (out) {
      note = ` and took ${out.id} back out of CC Rules`;
      renumbered = out.renumbered ? `\n${out.renumbered}` : '';
    }
  }
  fs.renameSync(dir, `${dir}.undone`);
  const what = manifest.action === 'move' ? 'the move of' : 'the removal of';
  return `Undid ${what} "${manifest.text}": put ${manifest.label} back${note}.${renumbered}`;
}

module.exports = { scan, suggest, adopt, clean, keep, undo, ruleLike };
