'use strict';
// Finding rules outside CC Rules, and moving, removing, keeping and undoing them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const finder = require('../scripts/lib/finder');
const rulebook = require('../scripts/lib/rulebook');
const { SESSION, world, desktopChat, where, load, write, read, exists, cli } = require('./helpers');

// Only what a test made: a real ~/.claude above the temp folder stays out of it.
function scanned(w, opts = {}) {
  const found = finder.scan(where(w, opts), w.env);
  const mine = (item) => path.resolve(item.file).toLowerCase().startsWith(path.resolve(w.base).toLowerCase());
  return { ...found, items: found.items.filter(mine) };
}

function texts(found) {
  return found.items.map((item) => item.text);
}

function memoryDir(w) {
  return path.join(w.claude, 'projects', path.resolve(w.root).replace(/[^A-Za-z0-9]/g, '-'), 'memory');
}

// Adopt through the same path the command line takes.
function adoptTo(w, id, level = 'global') {
  const state = load(w);
  return finder.adopt(state.where, w.env, id, (text) => {
    const message = rulebook.addRule(state, { level, text });
    return { message, file: state[level].file };
  });
}

test('rules files: every list item, with the heading it sits under', (t) => {
  const w = world(t);
  write(path.join(w.root, 'notes', 'RULES-EXPORT.md'), '# Rules\n\n## Global (every chat)\n\n1. Each chat works on one program only.\n2. Licensing: Keygen + Paddle is the default.\n\n## Project: Site\n\n- Show the diff before pushing.\n');
  const found = scanned(w);
  assert.deepEqual(texts(found), ['Each chat works on one program only.', 'Licensing: Keygen + Paddle is the default.', 'Show the diff before pushing.']);
  assert.deepEqual(found.items.map((i) => [i.label, i.line, i.section]), [
    ['notes/RULES-EXPORT.md', 5, 'Global (every chat)'],
    ['notes/RULES-EXPORT.md', 6, 'Global (every chat)'],
    ['notes/RULES-EXPORT.md', 10, 'Project: Site'],
  ]);
});

test('CLAUDE.md files: only short lines that read as instructions, outside knowledge sections', (t) => {
  const w = world(t);
  write(
    path.join(w.root, 'App', 'CLAUDE.md'),
    [
      '# App',
      '',
      'The app stores data in SQLite.',
      '',
      '## Working here',
      '',
      '- Never push straight to main.',
      '- `npm test` runs the tests.',
      '- Tone: plain and direct.',
      `- Always ${'explain the whole thing at great length '.repeat(6)}`,
      '',
      '## Things learned the hard way',
      '',
      '- Never call the API twice in one tick.',
      '',
      '```',
      '- Never inside a code block.',
      '```',
    ].join('\n'),
  );
  assert.deepEqual(texts(scanned(w)), ['Never push straight to main.']);
});

test('every place rules hide is searched, and skipped folders and CC Rules itself are not', (t) => {
  const w = world(t);
  write(path.join(w.claude, 'CLAUDE.md'), '- Always answer in plain English.\n');
  write(path.join(w.claude, 'rules', 'style.md'), '- Prefer short sentences.\n');
  write(path.join(w.root, 'CLAUDE.md'), '- Ask before deleting files.\n');
  write(path.join(w.root, 'Site', '.claude', 'rules', 'deploy.md'), '- Deploy on Fridays only after a review.\n');
  write(path.join(w.root, 'Site', 'AGENTS.md'), '- Keep the README current.\n');
  write(path.join(w.root, 'Site', 'node_modules', 'pkg', 'CLAUDE.md'), '- Never seen.\n');
  write(path.join(w.root, 'a', 'b', 'c', 'd', 'CLAUDE.md'), '- Too deep to look at.\n');
  write(path.join(w.root, '.claude', 'chat-rules', 'PROJECT.md'), '- [x] R4: Use metric units\n');
  write(path.join(w.root, '.claude', 'cc-rules', 'PROJECT.md'), '- [x] PR1: Already in CC Rules\n');
  write(path.join(memoryDir(w), 'feedback-x.md'), '---\nname: x\ndescription: d\nmetadata:\n  type: feedback\n---\n\nNever add AI credits to commits.\n\n**Why:** asked.\n');
  write(path.join(memoryDir(w), 'project-y.md'), '---\nname: y\ndescription: d\nmetadata:\n  type: project\n---\n\nNever mind, a project note.\n');
  const found = scanned(w);
  assert.deepEqual(texts(found).sort(), [
    'Always answer in plain English.',
    'Ask before deleting files.',
    'Deploy on Fridays only after a review.',
    'Keep the README current.',
    'Never add AI credits to commits.',
    'Prefer short sentences.',
    'Use metric units',
  ]);
  const memory = found.items.find((i) => i.kind === 'memory');
  assert.equal(memory.label, "Claude's memory (My Project): feedback-x.md");
});

test('move into CC Rules takes the rule out of its file, with a backup; undo puts it all back', (t) => {
  const w = world(t);
  const file = path.join(w.root, 'CLAUDE.md');
  const original = '# Notes\n\n- Ask before deleting files.\n- Keep commits small and focused.\n\nThe app uses SQLite.\n';
  write(file, original);
  const [first] = scanned(w).items;
  const said = adoptTo(w, first.id, 'global');
  assert.match(said, /^Added GR1 to global rules: Ask before deleting files\.\nTook it out of CLAUDE\.md\. A backup is kept/);
  assert.equal(read(file), '# Notes\n\n- Keep commits small and focused.\n\nThe app uses SQLite.\n');
  assert.match(read(w.global), /- \[x\] GR1: Ask before deleting files\.\n$/);
  assert.equal(fs.readdirSync(path.join(w.home, '.backups')).length, 1);

  assert.equal(finder.undo(where(w), rulebook.removeFromFile), 'Undid the move of "Ask before deleting files.": put CLAUDE.md back and took GR1 back out of CC Rules.');
  assert.equal(read(file), original);
  assert.ok(!read(w.global).includes('Ask before deleting files'));
  assert.throws(() => finder.undo(where(w), rulebook.removeFromFile), /Nothing to undo/);
});

test('undo finds the moved rule by its wording after the numbers have changed', (t) => {
  const w = world(t);
  write(path.join(w.root, 'CLAUDE.md'), '- Ask before deleting files.\n');
  write(w.global, '- [x] GR1: One\n');
  const [item] = scanned(w).items;
  assert.match(adoptTo(w, item.id, 'global'), /^Added GR2 to global rules: Ask before deleting files\./);
  rulebook.addRule(load(w), { level: 'global', text: 'Later' });
  rulebook.removeRule(load(w), 'GR1');
  assert.equal(read(w.global), '- [x] GR1: Ask before deleting files.\n- [x] GR2: Later\n');
  assert.equal(
    finder.undo(where(w), rulebook.removeFromFile),
    'Undid the move of "Ask before deleting files.": put CLAUDE.md back and took GR1 back out of CC Rules.\nGlobal rules renumbered: GR2 is now GR1.',
  );
  assert.equal(read(w.global), '- [x] GR1: Later\n');
});

test('a rule that reached CC Rules after the scan is only taken out of its file', (t) => {
  const w = world(t);
  write(path.join(w.root, 'CLAUDE.md'), '- Ask before deleting files.\n');
  const [item] = scanned(w).items;
  write(w.global, '- [x] GR1: Ask before deleting files.\n');
  assert.match(adoptTo(w, item.id), /^Already in CC Rules: GR1 in global rules already says that\.\nTook it out of CLAUDE\.md/);
  assert.equal(read(path.join(w.root, 'CLAUDE.md')), '');
});

test('a hidden rule can go to another sidebar group', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  write(path.join(w.root, 'site-rules.md'), '- No third-party scripts.\n');
  const [item] = scanned(w).items;
  const r = cli(w, ['adopt', item.id, '--to', 'group:Websites']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Added PR1 to project "Websites": No third-party scripts\./);
  assert.match(read(path.join(w.projects, 'Websites.md')), /Linked to project cg-web\.[\s\S]*- \[x\] PR1: No third-party scripts\./);
  const bad = cli(w, ['adopt', 'H000000', '--to', 'group:Nowhere']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /No sidebar group "Nowhere"\. Groups: Apps, Websites\./);
});

test('remove takes it out; for a memory note the note and its index line go, and undo restores both', (t) => {
  const w = world(t);
  const dir = memoryDir(w);
  const note = '---\nname: x\ndescription: d\nmetadata:\n  type: feedback\n---\n\nNever add AI credits.\n';
  const index = '- [X](feedback-x.md) — no AI credits\n- [Y](project-y.md) — a project\n';
  write(path.join(dir, 'feedback-x.md'), note);
  write(path.join(dir, 'MEMORY.md'), index);
  const [item] = scanned(w).items;
  assert.match(finder.clean(where(w), w.env, item.id), /^Removed from Claude's memory \(My Project\): feedback-x\.md: Never add AI credits\./);
  assert.equal(exists(path.join(dir, 'feedback-x.md')), false);
  assert.equal(read(path.join(dir, 'MEMORY.md')), '- [Y](project-y.md) — a project\n');
  finder.undo(where(w), rulebook.removeFromFile);
  assert.equal(read(path.join(dir, 'feedback-x.md')), note);
  assert.equal(read(path.join(dir, 'MEMORY.md')), index);
});

test('keep stops listing a rule; a file changed since the scan is refused', (t) => {
  const w = world(t);
  const file = path.join(w.root, 'rules.md');
  write(file, '- One rule here.\n- Another rule here.\n');
  const [one, two] = scanned(w).items;
  assert.equal(finder.keep(where(w), w.env, one.id), 'Kept in rules.md, and it won\'t be listed again: One rule here.');
  const after = scanned(w);
  assert.deepEqual(texts(after), ['Another rule here.']);
  assert.ok(after.ignored >= 1);
  write(file, '- One rule here.\n- Another rule, reworded.\n');
  assert.throws(() => finder.clean(where(w), w.env, two.id), /No hidden rule H[0-9a-f]{6}: its file changed or it's gone\. Scan again\./);
});

test('scan --json gives the panel the rules and where they can go', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  write(path.join(w.root, 'rules.md'), '- One rule here.\n');
  const r = cli(w, ['scan', '--json']);
  assert.equal(r.code, 0, r.err);
  const data = JSON.parse(r.out);
  const item = data.items.find((i) => i.text === 'One rule here.');
  assert.match(item.id, /^H[0-9a-f]{6}$/);
  assert.deepEqual(item.targets, [
    { value: 'global', label: 'Global (every chat)' },
    { value: 'chat', label: 'This chat: Chat' },
    { value: 'project', label: 'Project: Apps' },
    { value: 'group:cg-web', label: 'Project: Websites' },
    { value: 'keep', label: 'Keep it where it is' },
  ]);
  assert.equal(item.raw, undefined, 'the panel gets only what it shows');
  const text = cli(w, ['scan']).out;
  assert.match(text, /^Hidden rules: \d+ found/);
  assert.match(text, /\nrules\.md\n- H[0-9a-f]{6} \(line 1\): One rule here\./);
});

test('rules CC Rules already has are left out of the scan', (t) => {
  const w = world(t);
  write(w.global, '- [x] GR1: One rule here\n');
  write(path.join(w.chats, 'Other.md'), 'Linked to chat other.\n- [ ] CR1: A paused chat rule.\n');
  write(path.join(w.root, 'rules.md'), '- One rule here.\n- A paused chat rule\n- A new rule here.\n');
  const found = scanned(w);
  assert.deepEqual(texts(found), ['A new rule here.']);
  assert.equal(found.assigned, 2);
});

test('suggestions: the project and chat a rule was written for', (t) => {
  const w = world(t);
  const groups = [
    { id: 'cg-apps', name: 'Apps' },
    { id: 'cg-web', name: 'Websites' },
    { id: 'cg-win', name: 'Windows Applications' },
  ];
  desktopChat(w, { title: 'Chat', group: 'cg-apps', groups });
  const chat = (local, sessionId, title, group, when) =>
    desktopChat(w, { local, sessionId, title, group, groups, record: { lastActivityAt: when } });
  chat('local_2', 'bench', 'Benchdrop', 'cg-win', 3);
  chat('local_3', 'retest', 'ClockRoute Benchdrop retest', 'cg-apps', 9);
  chat('local_4', 'parody', 'Parody Archade', 'cg-web', 2);
  chat('local_5', 'body', 'BodyMindLog build', null, 1);
  desktopChat(w, { local: 'local_6', sessionId: 'old', title: 'Benchdrop', group: 'cg-web', groups, record: { isArchived: true } });
  write(path.join(w.root, 'Benchdrop', 'CLAUDE.md'), '- Never push straight to main.\n');
  write(path.join(w.root, 'notes', 'rules.md'), '## Project: Body Mind Log and Parody Arcade (same wording)\n\n- Build in the order given.\n\n## Global (every chat)\n\n- Ask before deleting files.\n');
  write(path.join(w.claude, 'CLAUDE.md'), '- Always answer in plain English.\n');
  const desktop = require('../scripts/lib/desktop');
  const chats = desktop.chats(w.env);
  assert.deepEqual(chats.map((c) => c.sessionId), ['retest', 'bench', 'parody', 'body', SESSION], 'archived left out, newest first');
  const state = where(w);
  const byText = Object.fromEntries(scanned(w).items.map((item) => [item.text, finder.suggest(item, state, chats)]));
  // An exact name beats a partial one.
  assert.deepEqual(byText['Never push straight to main.'], { global: false, groups: [{ id: 'cg-win', name: 'Windows Applications' }], chats: [{ sessionId: 'bench', title: 'Benchdrop' }] });
  // Two programs in one heading, one through a typo in its chat's name.
  assert.deepEqual(byText['Build in the order given.'].chats.map((c) => c.title), ['BodyMindLog build', 'Parody Archade']);
  assert.deepEqual(byText['Build in the order given.'].groups.map((g) => g.name), ['Websites']);
  assert.equal(byText['Ask before deleting files.'].global, true);
  assert.equal(byText['Always answer in plain English.'].global, true);
});

test('adopt --to session:<id> gives the rule to another chat; --to keep keeps it', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat' });
  desktopChat(w, { local: 'local_2', sessionId: 'other-chat', title: 'Site work' });
  write(path.join(w.root, 'rules.md'), '- Show the diff before pushing.\n- Keep commits small.\n');
  const [first, second] = scanned(w).items;
  const r = cli(w, ['adopt', first.id, '--to', 'session:other-chat']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Added CR1 to chat "Site work": Show the diff before pushing\.\nTook it out of rules\.md/);
  assert.match(read(path.join(w.chats, 'Site work.md')), /^# Chat rules: Site work\n[\s\S]*Linked to chat other-chat\.[\s\S]*- \[x\] CR1: Show the diff before pushing\.\n$/);
  const kept = cli(w, ['adopt', second.id, '--to', 'keep']);
  assert.match(kept.out, /^Kept in rules\.md, and it won't be listed again: Keep commits small\./);
  assert.equal(read(path.join(w.root, 'rules.md')), '- Keep commits small.\n');
});

test('ruleLike tells instructions from notes', () => {
  for (const yes of ['Never push to main.', 'Ask before deleting.', 'Tone: keep it plain.', 'Commits must be signed.']) {
    assert.ok(finder.ruleLike(yes), yes);
  }
  for (const no of ['The app stores data in SQLite.', '`npm test` runs the tests.', 'Version 2 added sync.']) {
    assert.ok(!finder.ruleLike(no), no);
  }
  assert.ok(SESSION);
});
