'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SESSION, CLI, world, desktopChat, write, read, cli } = require('./helpers');
const { spawnSync } = require('node:child_process');

test('add reads rule text from stdin unchanged', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat' });
  const text = 'Quote "this", keep $HOME and `ticks` as typed';
  const r = cli(w, ['add', '--stdin'], { input: `${text}\n` });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.split('\n')[0], `Added R1 to this chat: ${text}`);
  assert.ok(read(path.join(w.chats, 'Chat.md')).endsWith(`- [x] R1: ${text}\n`));
});

test('add takes --text or the words after the command, at any level', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  assert.equal(cli(w, ['add', 'Be', 'brief']).out.split('\n')[0], 'Added R1 to this chat: Be brief');
  assert.equal(cli(w, ['add', '--level', 'project', '--paused', '--text', 'Use metric']).out.split('\n')[0], 'Added R2 to project "Apps" (paused): Use metric');
  assert.equal(cli(w, ['add', '--level=global', 'Cite sources']).out.split('\n')[0], 'Added R3 to global rules: Cite sources');
  assert.equal(cli(w, ['add', '--level', 'everywhere', 'No emoji']).out, 'Added R4 to global rules: No emoji');
});

test('pause, resume, remove and move take several IDs', (t) => {
  const w = world(t);
  write(w.global, '- [x] R1: One\n- [x] R2: Two\n- [x] R3: Three\n');
  assert.equal(cli(w, ['pause', 'R1', 'r2']).out, 'Paused R1 in global rules: One\nPaused R2 in global rules: Two');
  assert.equal(cli(w, ['resume', '2']).out, 'Resumed R2 in global rules: Two');
  const moved = cli(w, ['move', 'R1', 'R3', 'to', 'this-chat']);
  assert.equal(moved.code, 0, moved.err);
  assert.match(moved.out, /^Moved R1 from global rules to this chat \(paused\): One\nOnly this chat gets it now\.\n/);
  assert.match(moved.out, /\nMoved R3 from global rules to this chat: Three\n/);
  assert.equal(read(w.global), '- [x] R2: Two\n');
  assert.equal(cli(w, ['move', 'R3', '--to', 'project']).out.split('\n')[0], 'Moved R3 from this chat to project "My Project": Three');
  assert.equal(cli(w, ['remove', 'R3']).out, 'Removed R3 from project "My Project": Three');
});

test('hand edits between commands are picked up', (t) => {
  const w = world(t);
  cli(w, ['add', '--level', 'global', 'Be brief']);
  // The user edits the file by hand: rewords R1 and adds a rule with no ID.
  write(w.global, '# Mine\n- [x] R1: Be very brief\n- [x] Use headings\n');
  const r = cli(w, ['edit', 'R1', 'Be brief but kind']);
  assert.equal(
    r.out,
    'Note: Gave the new rule on line 3 of GLOBAL.md the ID R2: Use headings\n' +
      'Edited R1 in global rules: Be brief but kind (was: Be very brief)',
  );
  assert.equal(read(w.global), '# Mine\n- [x] R1: Be brief but kind\n- [x] R2: Use headings\n');
});

test('list works without a session and leaves out chat rules', (t) => {
  const w = world(t);
  write(w.global, '- [x] R1: One\n');
  write(path.join(w.chats, 'Chat.md'), `Linked to chat ${SESSION}.\n- [x] R2: Chat\n`);
  const r = cli(w, ['list'], { session: null });
  assert.match(r.out, /\| R1 \| global \| active \| One \|/);
  assert.ok(!r.out.includes('R2'));
  assert.match(r.out, /not shown \(no session ID given\)/);
  const add = cli(w, ['add', 'x'], { session: null });
  assert.equal(add.code, 1);
  assert.match(add.err, /^Error: This chat's session ID is needed/);
});

test('--root defaults to CLAUDE_PROJECT_DIR', (t) => {
  const w = world(t);
  write(w.folderProject, '- [x] R1: From the env folder\n');
  const r = spawnSync(process.execPath, [CLI, 'list'], {
    encoding: 'utf8',
    env: { ...process.env, ...w.env, CLAUDE_PROJECT_DIR: w.root },
  });
  assert.match(r.stdout, /From the env folder/);
});

test('bad input exits 1 with a plain error message', (t) => {
  const w = world(t);
  for (const [args, message] of [
    [['frobnicate'], /Unknown command "frobnicate"/],
    [['list', '--colour'], /Unknown option --colour/],
    [['pause'], /Which rule\? Example: pause R3/],
    [['move', 'R1'], /Move it where\?/],
    [['add', '--level', 'galaxy', 'x'], /Unknown level "galaxy"/],
    [['remove', 'R7'], /There's no rule R7\. There are no rules yet\./],
  ]) {
    const r = cli(w, args);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.err, message);
    assert.ok(!r.err.includes('    at '), 'no stack trace');
  }
  const bad = cli(w, ['list'], { session: '../../etc' });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /isn't a valid chat session ID/);
});

test('list --json gives the panel its data, and --no-snapshot leaves the snapshot alone', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  write(w.global, '- [x] R1: One\n- [ ] R2: Two\n');
  const r = cli(w, ['list', '--json', '--no-snapshot']);
  assert.equal(r.code, 0, r.err);
  const data = JSON.parse(r.out);
  assert.deepEqual(data.project, { kind: 'group', name: 'Apps' });
  assert.equal(data.chatTitle, 'Chat');
  assert.deepEqual(data.levels.map((l) => [l.level, l.exists, l.rules.length]), [['global', true, 2], ['project', false, 0], ['chat', false, 0]]);
  assert.deepEqual(data.levels[0].rules[1], { id: 'R2', active: false, text: 'Two' });
  assert.equal(data.watch.length, 5, 'three rule files, the desktop record and its settings');
  const snapshotFile = path.join(w.home, '.state', `${SESSION}.json`);
  assert.equal(require('node:fs').existsSync(snapshotFile), false);
  cli(w, ['pause', 'R1', '--no-snapshot']);
  assert.equal(require('node:fs').existsSync(snapshotFile), false);
  cli(w, ['list']);
  assert.equal(require('node:fs').existsSync(snapshotFile), true, 'a normal command records what Claude saw');
});

test('help and context', (t) => {
  const w = world(t);
  assert.match(cli(w, ['--help']).out, /^CC Rules: rules you can see and edit, at three levels\./);
  const context = cli(w, ['context']).out;
  assert.match(context, /^# CC Rules/);
  assert.match(context, new RegExp(`scripts/rules\\.js" --root "[^"]+" --session ${SESSION} <command>`));
  assert.ok(context.includes(process.execPath.split('\\').join('/')), 'uses the absolute node path');
});
