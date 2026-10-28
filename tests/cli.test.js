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
  assert.equal(r.out.split('\n')[0], `Added CR1 to this chat: ${text}`);
  assert.ok(read(path.join(w.chats, 'Chat.md')).endsWith(`- [x] CR1: ${text}\n`));
});

test('add takes --text or the words after the command, at any level', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  assert.equal(cli(w, ['add', 'Be', 'brief']).out.split('\n')[0], 'Added CR1 to this chat: Be brief');
  assert.equal(cli(w, ['add', '--level', 'project', '--paused', '--text', 'Use metric']).out.split('\n')[0], 'Added PR1 to project "Apps" (paused): Use metric');
  assert.equal(cli(w, ['add', '--level=global', 'Cite sources']).out.split('\n')[0], 'Added GR1 to global rules: Cite sources');
  assert.equal(cli(w, ['add', '--level', 'everywhere', 'No emoji']).out, 'Added GR2 to global rules: No emoji');
});

test('pause, resume, remove and move take several IDs', (t) => {
  const w = world(t);
  write(w.global, '- [x] GR1: One\n- [x] GR2: Two\n- [x] GR3: Three\n');
  assert.equal(cli(w, ['pause', 'GR1', 'g2']).out, 'Paused GR1 in global rules: One\nPaused GR2 in global rules: Two');
  assert.equal(cli(w, ['resume', '2']).out, 'Resumed GR2 in global rules: Two');
  const moved = cli(w, ['move', 'GR1', 'GR3', 'to', 'this-chat']);
  assert.equal(moved.code, 0, moved.err);
  assert.match(moved.out, /^Moved GR1 from global rules to this chat as CR1 \(paused\): One\nOnly this chat gets it now\.\n/);
  assert.match(moved.out, /\nMoved GR3 from global rules to this chat as CR2: Three\nOnly this chat gets it now\.\nGlobal rules renumbered: GR2 is now GR1\.$/);
  assert.equal(read(w.global), '- [x] GR1: Two\n');
  assert.equal(cli(w, ['move', 'CR2', '--to', 'project']).out.split('\n')[0], 'Moved CR2 from this chat to project "My Project" as PR1: Three');
  assert.equal(cli(w, ['remove', 'PR1', 'CR1']).out, 'Removed PR1 from project "My Project": Three\nRemoved CR1 from this chat: One');
});

test('hand edits between commands are picked up', (t) => {
  const w = world(t);
  cli(w, ['add', '--level', 'global', 'Be brief']);
  // The user edits the file by hand: rewords GR1 and adds a rule with no ID.
  write(w.global, '# Mine\n- [x] GR1: Be very brief\n- [x] Use headings\n');
  const r = cli(w, ['edit', 'GR1', 'Be brief but kind']);
  assert.equal(
    r.out,
    'Note: Gave the new rule on line 3 of GLOBAL.md the ID GR2: Use headings\n' +
      'Edited GR1 in global rules: Be brief but kind (was: Be very brief)',
  );
  assert.equal(read(w.global), '# Mine\n- [x] GR1: Be brief but kind\n- [x] GR2: Use headings\n');
});

test('list works without a session and leaves out chat rules', (t) => {
  const w = world(t);
  write(w.global, '- [x] GR1: One\n');
  write(path.join(w.chats, 'Chat.md'), `Linked to chat ${SESSION}.\n- [x] CR1: Chat\n`);
  const r = cli(w, ['list'], { session: null });
  assert.match(r.out, /\| GR1 \| global \| active \| One \|/);
  assert.ok(!r.out.includes('CR1'));
  assert.match(r.out, /not shown \(no session ID given\)/);
  const add = cli(w, ['add', 'x'], { session: null });
  assert.equal(add.code, 1);
  assert.match(add.err, /^Error: This chat's session ID is needed/);
});

test('--root defaults to CLAUDE_PROJECT_DIR', (t) => {
  const w = world(t);
  write(w.folderProject, '- [x] PR1: From the env folder\n');
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
    [['pause'], /Which rule\? Example: pause GR3/],
    [['move', 'GR1'], /Move it where\?/],
    [['add', '--level', 'galaxy', 'x'], /Unknown level "galaxy"/],
    [['remove', 'GR7'], /There's no rule GR7\. There are no rules yet\./],
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
  write(w.global, '- [x] GR1: One\n- [ ] GR2: Two\n');
  const r = cli(w, ['list', '--json', '--no-snapshot']);
  assert.equal(r.code, 0, r.err);
  const data = JSON.parse(r.out);
  assert.deepEqual(data.project, { kind: 'group', name: 'Apps' });
  assert.equal(data.chatTitle, 'Chat');
  assert.deepEqual(data.levels.map((l) => [l.level, l.exists, l.rules.length]), [['global', true, 2], ['project', false, 0], ['chat', false, 0]]);
  assert.deepEqual(data.levels[0].rules[1], { id: 'GR2', active: false, text: 'Two' });
  assert.equal(data.watch.length, 5, 'three rule files, the desktop record and its settings');
  const snapshotFile = path.join(w.home, '.state', `${SESSION}.json`);
  assert.equal(require('node:fs').existsSync(snapshotFile), false);
  cli(w, ['pause', 'GR1', '--no-snapshot']);
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
