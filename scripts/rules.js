#!/usr/bin/env node
'use strict';
// CC Rules command line. Claude runs this for /rules (see skills/rules/SKILL.md);
// people can run it too. Every command re-reads the rule files first.
//
//   node rules.js [--root DIR] [--session ID] <command> [args]

const fs = require('node:fs');
const path = require('node:path');
const { resolve, RulesError } = require('./lib/where');
const rulebook = require('./lib/rulebook');
const snapshot = require('./lib/snapshot');
const finder = require('./lib/finder');
const desktop = require('./lib/desktop');

const HELP = `CC Rules: rules you can see and edit, at three levels.
  global   every chat                      (highest: wins any conflict)
  project  every chat in this project      (its desktop sidebar group, or its folder)
  chat     this chat only                  (lowest)

Usage: node rules.js [--root DIR] [--session ID] <command> [args]

Commands:
  list                          every rule with its ID, level and status
  add <text>                    add a rule to this chat
      --level project|global    ...or to this project, or to every chat
      --paused                  add it switched off
      --title <text>            name for this chat's file, if the chat has no name yet
  edit <ID> <text>              change a rule's wording
  remove <ID>...                delete rules
  pause <ID>...                 switch rules off (the line stays, unchecked)
  resume <ID>...                switch rules back on
  move <ID>... --to global|project|chat
  context                       the text Claude gets when a chat starts

Hidden rules (rules outside CC Rules, in CLAUDE.md files, .claude/rules,
Claude's memory, files named *rules*.md and old Chat Rules files):
  scan                          list them, each with an ID like H1a2b3c
  adopt <ID> --to <target>      move one into CC Rules: global, project, chat,
                                group:<id or name> for another sidebar group,
                                or session:<id> for another chat; keep = leave it
  clean <ID>                    take one out of its file
  keep <ID>...                  leave them where they are and stop listing them
  undo                          put back the latest adopt or clean
Every adopt and clean backs up the files it changes first.

Rule text can come from --text <text>, from --stdin, or from the words after
the command. --root is the chat's folder (default: $CLAUDE_PROJECT_DIR, then
the current folder). --session is the chat's session ID; chat rules and
sidebar-group projects need it.

For the CC Rules panel: list --json prints the rules as data, and
--no-snapshot leaves the record of what Claude was last told alone, so the
check before the next message still tells Claude about the change.`;

const VALUE_OPTIONS = new Set(['root', 'session', 'level', 'to', 'text', 'title']);
const FLAG_OPTIONS = new Set(['stdin', 'paused', 'help', 'json', 'no-snapshot']);

function parseArgs(argv) {
  const opts = {};
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      words.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h') {
      opts.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      words.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (FLAG_OPTIONS.has(key)) {
      opts[key] = true;
    } else if (VALUE_OPTIONS.has(key)) {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined) throw new RulesError(`--${key} needs a value.`);
      opts[key] = value;
    } else {
      throw new RulesError(`Unknown option --${key}. Run with --help for usage.`);
    }
  }
  return { opts, words };
}

const LEVEL_WORDS = {
  chat: 'chat',
  session: 'chat',
  project: 'project',
  group: 'project',
  folder: 'project',
  global: 'global',
  all: 'global',
  everywhere: 'global',
  'every-chat': 'global',
};

function parseLevel(raw) {
  const word = String(raw).toLowerCase().replace(/^this[\s_-]*/, '');
  if (LEVEL_WORDS[word]) return LEVEL_WORDS[word];
  throw new RulesError(`Unknown level "${raw}". Use global, project or chat.`);
}

function ruleText(opts, words) {
  if (opts.text !== undefined) return opts.text;
  if (opts.stdin) return fs.readFileSync(0, 'utf8');
  return words.join(' ');
}

function needIds(ids, command, example = "R3") {
  if (!ids.length) throw new RulesError(`Which rule? Example: ${command} ${example}`);
  return ids;
}

function slash(p) {
  return p.split(path.sep).join('/');
}

// The command line Claude should use in this chat, with absolute paths so it
// works from any folder and without node on PATH.
function commandPrefix(root, sessionId) {
  const parts = [`"${slash(process.execPath)}"`, `"${slash(path.join(__dirname, 'rules.js'))}"`];
  parts.push(`--root "${slash(root)}"`);
  if (sessionId) parts.push(`--session ${sessionId}`);
  return parts.join(' ');
}

const TARGET_RE = /^(this[-_]?)?(chat|session|project|group|folder|global|all|everywhere|every-chat)$/i;

// Where one hidden rule can go, in the order the panel lists them: Global, the
// project and chat it seems written for (suggested), this chat, every other
// project, and keeping it where it is.
function itemTargets(item, where, chats) {
  const hint = finder.suggest(item, where, chats);
  const own = where.project;
  const groupValue = (g) => (own.kind === 'group' && own.id === g.id ? 'project' : `group:${g.id}`);
  const targets = [{ value: 'global', label: `Global (every chat)${hint.global ? ' · suggested' : ''}` }];
  const listed = new Set();
  for (const group of hint.groups) {
    listed.add(groupValue(group));
    targets.push({ value: groupValue(group), label: `Project: ${group.name} · suggested` });
  }
  for (const chat of hint.chats) {
    targets.push({ value: `session:${chat.sessionId}`, label: `Chat: ${chat.title || 'untitled'} · suggested` });
  }
  if (where.sessionId) targets.push({ value: 'chat', label: `This chat${where.chatTitle ? `: ${where.chatTitle}` : ''}` });
  if (!listed.has('project')) {
    listed.add('project');
    targets.push({ value: 'project', label: `Project: ${own.name}${own.kind === 'folder' ? ' (folder)' : ''}` });
  }
  for (const group of where.groups) {
    if (!listed.has(groupValue(group))) {
      listed.add(groupValue(group));
      targets.push({ value: groupValue(group), label: `Project: ${group.name}` });
    }
  }
  targets.push({ value: 'keep', label: 'Keep it where it is' });
  return targets;
}

// Where `adopt --to` sends a rule: a level, "group:<id or name>" for another
// sidebar group, or "session:<id>" for another chat.
function parseTarget(raw, where, env) {
  const session = /^session:(.+)$/i.exec(String(raw || ''));
  if (session) {
    return { level: 'chat', where: resolve({ sessionId: session[1].trim(), cwd: where.cwd, env }) };
  }
  const m = /^group:(.+)$/i.exec(String(raw || ''));
  if (!m) return { level: parseLevel(raw), where };
  const wanted = m[1].trim().toLowerCase();
  const group = where.groups.find((g) => g.id.toLowerCase() === wanted || g.name.toLowerCase() === wanted);
  if (!group) {
    const names = where.groups.map((g) => g.name).join(', ') || 'none';
    throw new RulesError(`No sidebar group "${m[1]}". Groups: ${names}.`);
  }
  return { level: 'project', where: { ...where, project: { kind: 'group', id: group.id, name: group.name } } };
}

function scanText(found) {
  const skipped = [
    found.assigned ? `${found.assigned} already in CC Rules` : '',
    found.ignored ? `${found.ignored} kept where they are` : '',
  ].filter(Boolean);
  const note = skipped.length ? ` Not listed: ${skipped.join(', ')}.` : '';
  if (!found.items.length) return `No hidden rules found.${note}`;
  const out = [`Hidden rules: ${found.items.length} found.${note}`];
  let label = null;
  for (const item of found.items) {
    if (item.label !== label) {
      label = item.label;
      out.push('', label);
    }
    const under = item.section ? `, under "${item.section}"` : '';
    out.push(`- ${item.id} (line ${item.line}${under}): ${item.text}`);
    const suggested = item.targets.filter((t) => t.label.endsWith(' · suggested'));
    if (suggested.length) {
      out.push(`  suggested: ${suggested.map((t) => `${t.value} (${t.label.replace(' · suggested', '')})`).join(', ')}`);
    }
  }
  out.push(
    '',
    'Move one with: adopt <ID> --to global|project|chat|group:<name>|session:<id>. Take one out with: clean <ID>.',
    'Leave one with: keep <ID>. Undo the last move or removal with: undo.',
  );
  return out.join('\n');
}

function run(argv, env = process.env) {
  const { opts, words } = parseArgs(argv);
  const [command = 'list', ...rest] = words;
  if (opts.help || command === 'help') return HELP;

  const where = resolve({
    sessionId: opts.session || null,
    cwd: opts.root || env.CLAUDE_PROJECT_DIR || process.cwd(),
    env,
  });
  const previous = where.sessionId ? snapshot.read(where.home, where.sessionId) : null;
  let state = rulebook.load(where, { hints: previous || {} });
  const notes = state.notices.map((notice) => `Note: ${notice}`);
  const withNotes = (lines) => [...notes, ...lines].join('\n');

  let output;
  switch (command) {
    case 'list':
    case 'ls':
    case 'reload':
      output = opts.json ? JSON.stringify(rulebook.viewData(state)) : rulebook.listText(state);
      break;
    case 'context':
      output = rulebook.contextText(state, commandPrefix(where.cwd, where.sessionId));
      break;
    case 'add':
      output = withNotes([
        rulebook.addRule(state, {
          level: parseLevel(opts.level || 'chat'),
          text: ruleText(opts, rest),
          active: !opts.paused,
          title: opts.title,
        }),
      ]);
      break;
    case 'edit': {
      const [id, ...text] = rest;
      needIds(id ? [id] : [], 'edit');
      output = withNotes([rulebook.editRule(state, id, ruleText(opts, text))]);
      break;
    }
    case 'remove':
    case 'rm':
    case 'delete':
      output = withNotes(needIds(rest, 'remove').map((id) => rulebook.removeRule(state, id)));
      break;
    case 'pause':
      output = withNotes(needIds(rest, 'pause').map((id) => rulebook.setActive(state, id, false)));
      break;
    case 'resume':
      output = withNotes(needIds(rest, 'resume').map((id) => rulebook.setActive(state, id, true)));
      break;
    case 'move': {
      // Accepts "move R3 --to project" and "move R3 to project".
      const ids = rest.filter((w) => !/^to$/i.test(w) && !TARGET_RE.test(w));
      const target = opts.to || rest.find((w) => TARGET_RE.test(w));
      if (!target) throw new RulesError('Move it where? Add --to global, --to project or --to chat.');
      const level = parseLevel(target);
      output = withNotes(needIds(ids, 'move').map((id) => rulebook.moveRule(state, id, level)));
      break;
    }
    case 'scan': {
      const found = finder.scan(where, env);
      const chats = desktop.chats(env);
      const items = found.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        label: item.label,
        line: item.line,
        section: item.section,
        text: item.text,
        targets: itemTargets(item, where, chats),
      }));
      output = opts.json ? JSON.stringify({ ...found, items }) : scanText({ ...found, items });
      break;
    }
    case 'adopt': {
      const [id, ...more] = rest;
      needIds(id ? [id] : [], 'adopt', 'H1a2b3c --to global');
      const to = opts.to || more.filter((w) => !/^to$/i.test(w))[0];
      if (!to) throw new RulesError('Move it where? Add --to global, project, chat, group:<name> or session:<id>.');
      if (/^keep$/i.test(to)) {
        output = finder.keep(where, env, id);
        break;
      }
      const target = parseTarget(to, where, env);
      const otherChat = target.level === 'chat' && target.where.sessionId !== where.sessionId;
      output = finder.adopt(where, env, id, (text) => {
        const into = target.where === where ? state : rulebook.load(target.where);
        let message = rulebook.addRule(into, { level: target.level, text });
        // Another chat's rules are "this chat" to that chat; name it here.
        if (otherChat) message = message.replace(/ (to|in) this chat/, ` $1 chat "${target.where.chatTitle || 'untitled'}"`);
        const doc = target.level === 'global' ? into.global : target.level === 'project' ? into.project : into.chat;
        return { message, file: doc.file };
      });
      break;
    }
    case 'clean':
      output = finder.clean(where, env, needIds(rest, 'clean', 'H1a2b3c')[0]);
      break;
    case 'keep':
      output = needIds(rest, 'keep', 'H1a2b3c').map((id) => finder.keep(where, env, id)).join('\n');
      break;
    case 'undo':
      output = finder.undo(where, rulebook.removeFromFile);
      state = rulebook.load(where);
      break;
    default:
      throw new RulesError(`Unknown command "${command}". Run with --help for usage.`);
  }
  // Claude has now seen the current rules, so the check before the next
  // message doesn't need to repeat them. Not so for the panel's calls: Claude
  // hasn't seen those, so the check must still tell it.
  if (where.sessionId && !opts['no-snapshot']) {
    snapshot.write(where.home, where.sessionId, snapshot.capture(state));
  }
  return output;
}

function main() {
  try {
    process.stdout.write(`${run(process.argv.slice(2))}\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof RulesError ? err.message : err.stack}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { commandPrefix };
