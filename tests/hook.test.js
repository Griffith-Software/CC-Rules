'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  PLUGIN,
  SESSION_START,
  PROMPT_CHECK,
  SESSION,
  world,
  desktopChat,
  write,
  read,
  list,
  cli,
  hook,
  findOnPath,
} = require('./helpers');

const RUN_NODE = path.join(PLUGIN, 'scripts', 'run-node.sh');

function input(w, extra = {}) {
  return { session_id: SESSION, cwd: w.root, hook_event_name: 'SessionStart', source: 'startup', ...extra };
}

function threeLevels(w) {
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  write(w.global, '- [x] R1: Always answer in plain English\n- [ ] R2: Paused rule\n');
  write(path.join(w.projects, 'Apps.md'), 'Linked to project cg-apps.\n- [x] R3: Use metric units\n');
  write(path.join(w.chats, 'Chat.md'), `Linked to chat ${SESSION}.\n- [x] R4: Keep replies under 200 words\n`);
}

// --- SessionStart --------------------------------------------------------------

test('SessionStart loads active rules from all three levels', (t) => {
  const w = world(t);
  threeLevels(w);
  const out = hook(SESSION_START, w, input(w));
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  const context = out.hookSpecificOutput.additionalContext;
  assert.match(context, /- R1 \(global rules\): Always answer in plain English/);
  assert.match(context, /- R3 \(project "Apps"\): Use metric units/);
  assert.match(context, /- R4 \(this chat\): Keep replies under 200 words/);
  assert.match(context, /Paused, do not follow: R2/);
  assert.match(context, new RegExp(`--session ${SESSION} <command>`));
  assert.equal(
    out.systemMessage,
    [
      'CC Rules: 3 active',
      '  R1 (global) Always answer in plain English',
      '  R3 (project) Use metric units',
      '  R4 (this chat) Keep replies under 200 words',
      '1 paused · project: Apps · /rules to see or change them',
    ].join('\n'),
  );
  assert.ok(fs.existsSync(path.join(w.home, '.state', `${SESSION}.json`)), 'remembers what Claude was told');
});

test('CLAUDE_PROJECT_DIR wins over cwd for the folder project', (t) => {
  const w = world(t);
  write(w.folderProject, '- [x] R1: Right folder\n');
  const out = hook(SESSION_START, w, input(w, { cwd: w.base }), { CLAUDE_PROJECT_DIR: w.root });
  assert.match(out.hookSpecificOutput.additionalContext, /Right folder/);
});

test('SessionStart uses the session title from its input outside the desktop app', (t) => {
  const w = world(t);
  write(path.join(w.chats, 'Old.md'), `Linked to chat ${SESSION}.\n- [x] R1: Mine\n`);
  const out = hook(SESSION_START, w, input(w, { session_title: 'Renamed with /rename' }));
  assert.match(out.systemMessage, /Note: Renamed the rules file for this chat to match its name: Renamed with rename\.md/);
  assert.deepEqual(list(w.chats), ['Renamed with rename.md']);
});

test('problems become a message for the user, never a failed session', (t) => {
  const w = world(t);
  const out = hook(SESSION_START, w, input(w, { session_id: '../bad' }));
  assert.equal(out.hookSpecificOutput, undefined);
  assert.match(out.systemMessage, /^CC Rules couldn't load the rules: "..\/bad" isn't a valid chat session ID/);
  const empty = hook(SESSION_START, w, '', { CLAUDE_PROJECT_DIR: w.root });
  assert.match(empty.systemMessage, /^CC Rules: no active rules\./);
});

// --- Before each message ------------------------------------------------------

function check(w, env) {
  return hook(PROMPT_CHECK, w, input(w, { hook_event_name: 'UserPromptSubmit', source: undefined }), env);
}

test('the per-message check is silent when nothing changed', (t) => {
  const w = world(t);
  threeLevels(w);
  hook(SESSION_START, w, input(w));
  assert.equal(check(w), null);
  assert.equal(check(w), null);
});

test('the per-message check picks up hand edits', (t) => {
  const w = world(t);
  threeLevels(w);
  hook(SESSION_START, w, input(w));
  write(w.global, '- [ ] R1: Always answer in plain English\n- [ ] R2: Paused rule\n- [x] Use tables\n');
  const out = check(w);
  assert.equal(
    out.systemMessage,
    [
      'CC Rules updated:',
      '  R1 (global) paused',
      '  R5 (global) now applies: Use tables',
      'CC Rules: Gave the new rule on line 3 of GLOBAL.md the ID R5: Use tables',
    ].join('\n'),
  );
  const context = out.hookSpecificOutput.additionalContext;
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(context, /^The chat rules changed since you last saw them:\n- R1 \(global\) paused\n/);
  assert.match(context, /The full list below replaces any earlier list/);
  assert.match(context, /- R5 \(global rules\): Use tables/);
  assert.equal(check(w), null, 'only once');
});

test('the per-message check follows the chat to another group', (t) => {
  const w = world(t);
  threeLevels(w);
  write(path.join(w.projects, 'Websites.md'), 'Linked to project cg-web.\n- [x] R7: Mobile first\n');
  hook(SESSION_START, w, input(w));
  desktopChat(w, { title: 'Chat', group: 'cg-web' });
  const out = check(w);
  assert.equal(
    out.systemMessage,
    [
      'CC Rules updated:',
      '  This chat is now in project "Websites".',
      '  R7 (project) now applies: Mobile first',
      '  R3 (project) no longer applies',
    ].join('\n'),
  );
  assert.match(out.hookSpecificOutput.additionalContext, /- R7 \(project "Websites"\): Mobile first/);
  assert.ok(!out.hookSpecificOutput.additionalContext.includes('Use metric units'));
});

test('the per-message check renames files when the chat or group is renamed', (t) => {
  const w = world(t);
  threeLevels(w);
  hook(SESSION_START, w, input(w));
  desktopChat(w, { title: 'Better name', group: 'cg-apps', groups: [{ id: 'cg-apps', name: 'Mobile apps' }] });
  const out = check(w);
  assert.equal(
    out.systemMessage,
    [
      'CC Rules updated:',
      '  Project "Apps" is now called "Mobile apps".',
      'CC Rules: Renamed the rules file for project "Mobile apps" to match its name: Mobile apps.md',
      'CC Rules: Renamed the rules file for this chat to match its name: Better name.md',
    ].join('\n'),
  );
  assert.deepEqual(list(w.projects), ['Mobile apps.md']);
  assert.deepEqual(list(w.chats), ['Better name.md']);
  assert.match(read(path.join(w.chats, 'Better name.md')), /R4: Keep replies under 200 words/);
  assert.equal(check(w), null);
});

test('changes made with /rules do not trigger the per-message check', (t) => {
  const w = world(t);
  threeLevels(w);
  hook(SESSION_START, w, input(w));
  assert.equal(cli(w, ['add', 'Use British spelling']).code, 0);
  assert.equal(check(w), null);
});

test('without a snapshot the per-message check gives the full rules once', (t) => {
  const w = world(t);
  threeLevels(w);
  const out = check(w);
  assert.match(out.systemMessage, /^CC Rules updated:\n {2}Loaded the rules for this chat\./);
  assert.match(out.hookSpecificOutput.additionalContext, /- R4 \(this chat\): Keep replies under 200 words/);
  assert.equal(check(w), null);
  assert.equal(hook(PROMPT_CHECK, w, { cwd: w.root }), null, 'no session, nothing to do');
});

// --- Finding Node ---------------------------------------------------------------

const sh = findOnPath('sh');

test('run-node.sh finds node from the plugin option, a folder, or PATH', { skip: !sh && 'sh not found' }, (t) => {
  const w = world(t);
  write(w.global, '- [x] R1: Through the launcher\n');
  const json = JSON.stringify(input(w));
  const run = (args, env) =>
    spawnSync(sh, [RUN_NODE, ...args], { input: json, encoding: 'utf8', env: { ...process.env, ...w.env, ...env } });

  for (const option of [process.execPath, path.dirname(process.execPath)]) {
    const r = run([SESSION_START], { CLAUDE_PLUGIN_OPTION_NODE_PATH: option });
    assert.equal(r.status, 0, r.stderr);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /Through the launcher/);
  }

  const bad = run([SESSION_START], { CLAUDE_PLUGIN_OPTION_NODE_PATH: path.join(w.base, 'no-such-node.exe') });
  assert.equal(bad.status, 0);
  assert.match(JSON.parse(bad.stdout).systemMessage, /Node\.js path doesn't point to node/);

  // An empty folder as PATH: no node anywhere.
  const none = { CLAUDE_PLUGIN_OPTION_NODE_PATH: '', PATH: w.base, Path: w.base };
  const r = run([SESSION_START], none);
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).systemMessage, /Node\.js wasn't found/);
  const quiet = run(['--quiet', PROMPT_CHECK], none);
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, '', '--quiet says nothing');
});
