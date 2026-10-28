'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rulebook = require('../scripts/lib/rulebook');
const { SESSION, world, desktopChat, load, write, read, exists, list } = require('./helpers');

// --- Parsing ---------------------------------------------------------------

test('parse finds checklist rules and their IDs, states and text', () => {
  const doc = rulebook.parse(
    [
      '# Rules',
      '- [x] GR3: Always answer in plain English',
      '* [ ] pr12 - Paused one',
      '+ [X] CR4. Capital X',
      '- [] GR5) Empty box counts as paused',
      '  - [x] GR6 Nested, no separator',
      '- [x] R7: An ID from before 1.1.0',
      '- [x] Rule without an ID',
      '- [x] C3PO is text, not an ID',
      '- [x] GR10:',
    ].join('\n'),
  );
  assert.deepEqual(
    doc.rules.map((r) => [r.id, r.active, r.text]),
    [
      ['GR3', true, 'Always answer in plain English'],
      ['PR12', false, 'Paused one'],
      ['CR4', true, 'Capital X'],
      ['GR5', false, 'Empty box counts as paused'],
      ['GR6', true, 'Nested, no separator'],
      ['R7', true, 'An ID from before 1.1.0'],
      [null, true, 'Rule without an ID'],
      [null, true, 'C3PO is text, not an ID'],
    ],
  );
});

test('parse ignores code fences and comments, and reports plain bullets', () => {
  const doc = rulebook.parse(
    ['```', '- [x] GR7: in a fence', '```', '<!--', '- [x] GR8: in a comment', '-->', '<!-- - [x] GR9: one line -->', '- a plain bullet', '- [x] GR1: real'].join('\n'),
  );
  assert.deepEqual(doc.rules.map((r) => r.id), ['GR1']);
  assert.deepEqual(doc.skipped.map((s) => [s.index, s.text]), [[7, '- a plain bullet']]);
});

test('fileName makes any name safe for a file', () => {
  assert.equal(rulebook.fileName('Login bug: final fix?'), 'Login bug final fix');
  assert.equal(rulebook.fileName('  a/b\\c  '), 'a b c');
  assert.equal(rulebook.fileName('...'), 'Untitled');
  assert.equal(rulebook.fileName('CON'), 'CON rules');
  assert.equal(rulebook.fileName('x'.repeat(200)).length, 80);
});

// --- Where the files are -----------------------------------------------------

test('a chat in no group uses its folder for project rules', (t) => {
  const w = world(t);
  const state = load(w);
  assert.equal(state.where.project.kind, 'folder');
  assert.equal(rulebook.addRule(state, { level: 'project', text: 'Use metric units' }).split('\n')[0], 'Added PR1 to project "My Project": Use metric units');
  assert.match(read(w.folderProject), /^# Project rules: My Project\n[\s\S]*isn't filed in a sidebar group[\s\S]*- \[x\] PR1: Use metric units\n$/);
});

test('global, group project and chat files live in the rules home, named after the group and chat', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Fix login bug', group: 'cg-apps' });
  const state = load(w);
  assert.deepEqual(state.where.project, { kind: 'group', id: 'cg-apps', name: 'Apps' });
  assert.equal(state.where.chatTitle, 'Fix login bug');
  assert.equal(rulebook.addRule(state, { level: 'global', text: 'Always answer in plain English' }).split('\n')[0], 'Added GR1 to global rules: Always answer in plain English');
  assert.equal(rulebook.addRule(state, { level: 'project', text: 'Use metric units' }).split('\n')[0], 'Added PR1 to project "Apps": Use metric units');
  assert.equal(rulebook.addRule(state, { text: 'Keep replies short' }).split('\n')[0], 'Added CR1 to this chat: Keep replies short');
  assert.match(read(w.global), /^# Global rules\n[\s\S]*outrank project and chat rules[\s\S]*- \[x\] GR1: Always/);
  assert.match(read(path.join(w.projects, 'Apps.md')), /^# Project rules: Apps\n[\s\S]*Linked to project cg-apps\. [\s\S]*- \[x\] PR1: Use metric units\n$/);
  assert.match(read(path.join(w.chats, 'Fix login bug.md')), new RegExp(`^# Chat rules: Fix login bug\\n[\\s\\S]*Linked to chat ${SESSION}\\. [\\s\\S]*- \\[x\\] CR1: Keep replies short\\n$`));
  assert.equal(exists(w.folderProject), false);
});

test('renaming the chat or its group renames the files, and the rules follow', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Fix login bug', group: 'cg-apps' });
  let state = load(w);
  rulebook.addRule(state, { level: 'project', text: 'Use metric units' });
  rulebook.addRule(state, { text: 'Keep replies short' });

  desktopChat(w, { title: 'Login bug: final fix', group: 'cg-apps', groups: [{ id: 'cg-apps', name: 'Applications' }] });
  state = load(w);
  assert.deepEqual(state.notices, [
    'Renamed the rules file for project "Applications" to match its name: Applications.md',
    'Renamed the rules file for this chat to match its name: Login bug final fix.md',
  ]);
  assert.deepEqual(list(w.projects), ['Applications.md']);
  assert.deepEqual(list(w.chats), ['Login bug final fix.md']);
  assert.match(read(path.join(w.chats, 'Login bug final fix.md')), /^# Chat rules: Login bug: final fix\n/);
  assert.match(read(path.join(w.projects, 'Applications.md')), /^# Project rules: Applications\n/);
  assert.deepEqual(rulebook.allRules(state).map(({ rule }) => rule.id), ['PR1', 'CR1']);
  assert.deepEqual(load(w).notices, [], 'nothing to do the second time');
});

test('a heading the user rewrote is left alone', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'First name' });
  rulebook.addRule(load(w), { text: 'Be brief' });
  const file = path.join(w.chats, 'First name.md');
  write(file, read(file).replace('# Chat rules: First name', '# My own heading'));
  desktopChat(w, { title: 'Second name' });
  load(w);
  assert.match(read(path.join(w.chats, 'Second name.md')), /^# My own heading\n/);
});

test('two chats with the same name get numbered files that stay put', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Same' });
  desktopChat(w, { sessionId: 'other-chat', local: 'local_2', title: 'Same' });
  rulebook.addRule(load(w), { text: 'First chat rule' });
  rulebook.addRule(load(w, { sessionId: 'other-chat' }), { text: 'Second chat rule' });
  assert.deepEqual(list(w.chats), ['Same (2).md', 'Same.md']);
  assert.deepEqual(load(w, { sessionId: 'other-chat' }).notices, []);
  assert.match(read(path.join(w.chats, 'Same (2).md')), /Second chat rule/);
});

test('filing the chat under another group switches its project rules', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  rulebook.addRule(load(w), { level: 'project', text: 'Apps rule' });
  desktopChat(w, { title: 'Chat', group: 'cg-web' });
  let state = load(w);
  assert.equal(state.where.project.name, 'Websites');
  assert.deepEqual(rulebook.allRules(state), []);
  desktopChat(w, { title: 'Chat' });
  state = load(w);
  assert.equal(state.where.project.kind, 'folder');
});

test('outside the desktop app the chat name comes from the transcript or session title', (t) => {
  const w = world(t);
  const transcript = path.join(w.claude, 'projects', 'C--x', `${SESSION}.jsonl`);
  write(
    transcript,
    [
      JSON.stringify({ type: 'user', message: 'hi' }),
      JSON.stringify({ type: 'custom-title', customTitle: 'Old name', sessionId: SESSION }),
      JSON.stringify({ type: 'custom-title', customTitle: 'New name', sessionId: SESSION }),
      '',
    ].join('\n'),
  );
  assert.equal(load(w).where.chatTitle, 'New name');
  assert.equal(load(w, { sessionTitle: 'From hook' }).where.chatTitle, 'From hook');
});

test('desktop settings in an unknown layout fall back to the folder, with a warning', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  write(path.join(w.desktop, 'claude_desktop_config.json'), JSON.stringify({ preferences: { epitaxyPrefs: { 'dframe-group-scopes': 'changed' } } }));
  const state = load(w);
  assert.equal(state.where.project.kind, 'folder');
  assert.equal(state.where.chatTitle, 'Chat');
  assert.match(state.notices[0], /couldn't read the desktop app's sidebar groups .* uses its folder's project rules/);
});

test('a hand-made file with the right name is adopted and linked', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-web' });
  write(path.join(w.projects, 'Websites.md'), '# Website rules\n- [x] Mobile first\n');
  const state = load(w);
  assert.ok(state.notices.includes('Linked Websites.md to project "Websites".'));
  assert.equal(read(path.join(w.projects, 'Websites.md')), '# Website rules\nLinked to project cg-web. Keep this line: it ties the file to the project, even after renames.\n- [x] PR1: Mobile first\n');
});

test('a new chat file can be named by Claude until the chat has a name', (t) => {
  const w = world(t);
  desktopChat(w, { title: null });
  rulebook.addRule(load(w), { text: 'Be brief', title: 'Planning the launch' });
  assert.deepEqual(list(w.chats), ['Planning the launch.md']);
  assert.match(read(path.join(w.chats, 'Planning the launch.md')), /^# Chat rules: Planning the launch\n/);
  assert.deepEqual(load(w).notices, [], 'no name yet, so the file keeps its name');
  desktopChat(w, { title: 'Launch plan' });
  load(w);
  assert.deepEqual(list(w.chats), ['Launch plan.md']);
});

// --- IDs ---------------------------------------------------------------------

test('each level counts from 1 in its own file, with its own letters', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat' });
  // Another chat's rules don't count.
  write(path.join(w.chats, 'Other.md'), 'Linked to chat other.\n- [x] CR1: Elsewhere\n- [x] CR2: Also elsewhere\n');
  const state = load(w);
  assert.equal(rulebook.addRule(state, { level: 'global', text: 'One' }).split('\n')[0], 'Added GR1 to global rules: One');
  assert.equal(rulebook.addRule(state, { level: 'project', text: 'Two' }).split('\n')[0], 'Added PR1 to project "My Project": Two');
  assert.equal(rulebook.addRule(state, { text: 'Three' }).split('\n')[0], 'Added CR1 to this chat: Three');
  assert.equal(rulebook.addRule(state, { level: 'global', text: 'Four' }), 'Added GR2 to global rules: Four');
});

test('removing a rule closes the gap and says which IDs changed', (t) => {
  const w = world(t);
  write(w.global, '- [x] GR1: One\n- [x] GR2: Two\n- [x] GR3: Three\n- [x] GR4: Four\n');
  const state = load(w);
  assert.equal(
    rulebook.removeRule(state, 'GR2'),
    'Removed GR2 from global rules: Two\nGlobal rules renumbered: GR3–GR4 are now GR2–GR3.',
  );
  assert.equal(read(w.global), '- [x] GR1: One\n- [x] GR2: Three\n- [x] GR3: Four\n');
  assert.equal(rulebook.removeRule(state, 'GR3'), 'Removed GR3 from global rules: Four');
  assert.equal(rulebook.addRule(state, { level: 'global', text: 'Five' }), 'Added GR3 to global rules: Five');
});

test('several IDs are all checked first, and mean the rules as they were', (t) => {
  const w = world(t);
  write(w.global, '- [x] GR1: One\n- [x] GR2: Two\n- [x] GR3: Three\n- [x] GR4: Four\n- [x] GR5: Five\n');
  const state = load(w, { sessionId: null });
  assert.throws(() => rulebook.removeRules(state, ['GR1', 'GR9']), /There's no rule GR9/);
  assert.equal(read(w.global), '- [x] GR1: One\n- [x] GR2: Two\n- [x] GR3: Three\n- [x] GR4: Four\n- [x] GR5: Five\n');
  assert.equal(
    rulebook.removeRules(state, ['GR2', 'gr4', '2']),
    [
      'Removed GR2 from global rules: Two',
      'Removed GR4 from global rules: Four',
      'Global rules renumbered: GR3 is now GR2, GR5 is now GR3.',
    ].join('\n'),
  );
  assert.equal(read(w.global), '- [x] GR1: One\n- [x] GR2: Three\n- [x] GR3: Five\n');
});

test('hand edits are renumbered by place: added, removed, copied and old IDs', (t) => {
  const w = world(t);
  write(w.global, '- [x] R1: Global one\n- [x] Typed by hand\n- [x] GR1: Copied line\n- [x] GR7: After a removed line\n');
  write(w.folderProject, '- [x] R12: Project rule from 1.0\n');
  const state = load(w);
  assert.deepEqual(state.notices, ['Gave the new rule on line 2 of GLOBAL.md the ID GR2: Typed by hand']);
  assert.equal(read(w.global), '- [x] GR1: Global one\n- [x] GR2: Typed by hand\n- [x] GR3: Copied line\n- [x] GR4: After a removed line\n');
  assert.equal(read(w.folderProject), '- [x] PR1: Project rule from 1.0\n');
  assert.deepEqual(load(w).notices, [], 'nothing to do the second time');
});

test('load still works when new IDs cannot be saved', (t) => {
  const w = world(t);
  write(w.global, '- [x] Typed by hand\n');
  t.mock.method(fs, 'writeFileSync', () => {
    throw new Error('disk is read-only');
  });
  const state = load(w);
  assert.equal(state.global.rules[0].id, 'GR1');
  assert.equal(state.notices.at(-1), "Couldn't save GLOBAL.md: disk is read-only");
});

test('load reports bullets that are not checklist lines', (t) => {
  const w = world(t);
  write(w.global, '- [x] GR1: Rule\n- Always use tabs\n');
  assert.deepEqual(load(w).notices, ["Line 2 of GLOBAL.md isn't a checklist line, so it isn't a rule: - Always use tabs"]);
});

// --- Changes -----------------------------------------------------------------

test('addRule cleans the text and inserts after the last rule, keeping notes', (t) => {
  const w = world(t);
  write(w.global, '# Mine\n\n## Style\n- [x] GR1: Be brief\n\n## Notes\nThis is my file.\n');
  rulebook.addRule(load(w), { level: 'global', text: '  - [ ] Use\n  short   words ' });
  assert.equal(read(w.global), '# Mine\n\n## Style\n- [x] GR1: Be brief\n- [x] GR2: Use short words\n\n## Notes\nThis is my file.\n');
});

test('addRule refuses duplicates and says where the rule already is', (t) => {
  const w = world(t);
  write(w.global, '- [ ] GR1: Use British spelling\n');
  write(w.folderProject, '- [x] PR1: Cite sources\n');
  desktopChat(w, { title: 'Chat' });
  write(path.join(w.chats, 'Chat.md'), `Linked to chat ${SESSION}.\n- [x] CR1: Keep replies short\n`);
  const state = load(w);
  assert.equal(
    rulebook.addRule(state, { text: 'use british spelling.' }),
    "Not added: GR1 in global rules already says that, and global rules apply to every chat. It's paused; resume it with: resume GR1",
  );
  assert.equal(rulebook.addRule(state, { text: 'Cite sources' }), 'Not added: PR1 in project "My Project" already says that, and project rules apply to this chat.');
  assert.equal(
    rulebook.addRule(state, { level: 'global', text: 'Keep replies short' }),
    'Not added: CR1 in this chat already says that. To make it apply more widely, move it: move CR1 --to global',
  );
  assert.equal(rulebook.addRule(state, { text: 'Keep  replies short!' }), 'Not added: CR1 in this chat already says that.');
});

test('edit, remove, pause and resume echo what changed', (t) => {
  const w = world(t);
  write(w.global, '- [x] GR1: Answer in English\n- [x] GR2: Be brief\n');
  const state = load(w);
  assert.equal(rulebook.editRule(state, 'GR1', 'Always answer in plain English'), 'Edited GR1 in global rules: Always answer in plain English (was: Answer in English)');
  assert.equal(rulebook.editRule(state, 'gr1', 'Always answer in plain English'), 'GR1 in global rules already says that. Nothing changed.');
  assert.equal(rulebook.editRule(state, '1', 'be brief'), 'Not changed: GR2 in global rules already says that.');
  assert.equal(rulebook.setActive(state, 'G2', false), 'Paused GR2 in global rules: Be brief');
  assert.equal(rulebook.setActive(state, 'GR2', false), 'GR2 in global rules is already paused: Be brief');
  assert.equal(read(w.global), '- [x] GR1: Always answer in plain English\n- [ ] GR2: Be brief\n');
  assert.equal(rulebook.setActive(state, 'R2', true), 'Resumed GR2 in global rules: Be brief');
  assert.equal(
    rulebook.removeRule(state, 'GR1'),
    'Removed GR1 from global rules: Always answer in plain English\nGlobal rules renumbered: GR2 is now GR1.',
  );
  assert.equal(read(w.global), '- [x] GR1: Be brief\n');
});

test('moveRule gives the rule the next ID at its new level and keeps it paused', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  write(path.join(w.chats, 'Chat.md'), `Linked to chat ${SESSION}.\n- [ ] CR1: Reply in bullet points\n- [x] CR2: Be brief\n`);
  const state = load(w);
  assert.equal(
    rulebook.moveRule(state, 'CR1', 'project'),
    [
      'Moved CR1 from this chat to project "Apps" as PR1 (paused): Reply in bullet points',
      'Every chat in project "Apps" now gets it.',
      `Created ${path.join(w.projects, 'Apps.md').split(path.sep).join('/')}`,
      "This chat's rules renumbered: CR2 is now CR1.",
    ].join('\n'),
  );
  assert.equal(
    rulebook.moveRule(state, 'PR1', 'global').split('\n').slice(0, 2).join('\n'),
    'Moved PR1 from project "Apps" to global rules as GR1 (paused): Reply in bullet points\nEvery chat now gets it.',
  );
  assert.equal(rulebook.moveRule(state, 'GR1', 'project').split('\n')[1], 'Only chats in project "Apps" get it now.');
  assert.deepEqual(rulebook.moveRule(state, 'p1', 'chat').split('\n'), [
    'Moved PR1 from project "Apps" to this chat as CR2 (paused): Reply in bullet points',
    'Only this chat gets it now.',
  ]);
  assert.equal(rulebook.moveRule(state, 'CR2', 'chat'), 'CR2 is already in this chat: Reply in bullet points');
  assert.match(read(path.join(w.chats, 'Chat.md')), /- \[x\] CR1: Be brief\n- \[ \] CR2: Reply in bullet points\n$/);
});

test('moving several rules checks every ID first and closes the gaps once', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat' });
  write(w.global, '- [x] GR1: One\n- [x] GR2: Two\n- [x] GR3: Three\n');
  const state = load(w);
  assert.deepEqual(rulebook.moveRules(state, ['GR1', 'GR3'], 'chat').split('\n'), [
    'Moved GR1 from global rules to this chat as CR1: One',
    'Only this chat gets it now.',
    `Created ${path.join(w.chats, 'Chat.md').split(path.sep).join('/')}`,
    'Moved GR3 from global rules to this chat as CR2: Three',
    'Only this chat gets it now.',
    'Global rules renumbered: GR2 is now GR1.',
  ]);
  assert.equal(read(w.global), '- [x] GR1: Two\n');
});

test('changes keep CRLF line endings, a BOM and the user’s own lines', (t) => {
  const w = world(t);
  write(w.global, '﻿# Rules\r\nmy note\r\n* [X] gr1 - Be brief\r\n');
  rulebook.setActive(load(w), 'GR1', false);
  assert.equal(read(w.global), '﻿# Rules\r\nmy note\r\n* [ ] GR1: Be brief\r\n');
});

test('errors name the problem and the valid IDs', (t) => {
  const w = world(t);
  write(w.global, '- [x] GR1: One\n- [x] GR2: Two\n');
  const state = load(w, { sessionId: null });
  assert.throws(() => rulebook.removeRule(state, 'GR9'), /There's no rule GR9\. Rules are: GR1 \(global rules\), GR2 \(global rules\)\. This chat's rules weren't checked/);
  assert.throws(() => rulebook.removeRule(state, 'PR1'), /There's no rule PR1\./);
  assert.throws(() => rulebook.setActive(state, 'first', false), /"first" isn't a rule ID\. IDs look like GR3 \(global\), PR3 \(project\) or CR3 \(this chat\)\./);
  assert.throws(() => rulebook.setActive(state, 'XR3', false), /"XR3" isn't a rule ID/);
  assert.throws(() => rulebook.addRule(state, { text: 'x' }), /session ID is needed/);
  assert.throws(() => rulebook.addRule(state, { level: 'global', text: '   ' }), /rule text is empty/);
  assert.throws(() => rulebook.addRule(state, { level: 'galaxy', text: 'x' }), /Unknown level "galaxy"/);
  assert.throws(() => load(w, { sessionId: '../escape' }), /isn't a valid chat session ID/);
});

// --- Views -------------------------------------------------------------------

function threeLevels(t) {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  write(w.global, '- [x] GR1: Use a | b\n- [ ] GR2: Secret paused text\n');
  write(path.join(w.projects, 'Apps.md'), 'Linked to project cg-apps.\n- [x] PR1: Use metric units\n');
  write(path.join(w.chats, 'Chat.md'), `Linked to chat ${SESSION}.\n- [x] CR1: Keep replies short\n`);
  return { w, state: load(w) };
}

test('listText shows every rule with ID, level and status, then the files', (t) => {
  const { w, state } = threeLevels(t);
  const slash = (p) => p.split(path.sep).join('/');
  assert.equal(
    rulebook.listText(state),
    [
      '| ID | Level | Status | Rule |',
      '| --- | --- | --- | --- |',
      '| GR1 | global | active | Use a \\| b |',
      '| GR2 | global | paused | Secret paused text |',
      '| PR1 | project: Apps | active | Use metric units |',
      '| CR1 | this chat | active | Keep replies short |',
      '',
      `Global rules: ${slash(w.global)}`,
      `Project "Apps" (sidebar group): ${slash(path.join(w.projects, 'Apps.md'))}`,
      `This chat "Chat": ${slash(path.join(w.chats, 'Chat.md'))}`,
      'If rules conflict, the higher level wins: global, then project, then this chat.',
    ].join('\n'),
  );
});

test('listText with no rules says how to add one', (t) => {
  const text = rulebook.listText(load(world(t)));
  assert.match(text, /^No rules yet\./);
  assert.match(text, /PROJECT\.md \(not created yet\)/);
});

test('summaryText lists active rules only, shortened and capped', (t) => {
  const w = world(t);
  const lines = ['- [ ] GR1: Paused rule', `- [x] GR2: ${'long '.repeat(30)}`];
  for (let i = 3; i <= 12; i++) lines.push(`- [x] GR${i}: Rule number ${i}`);
  write(w.global, `${lines.join('\n')}\n`);
  const out = rulebook.summaryText(load(w)).split('\n');
  assert.equal(out[0], 'CC Rules: 11 active');
  assert.match(out[1], /^ {2}GR2 \(global\) long long .*long…$/);
  assert.equal(out[1].length, '  GR2 (global) '.length + 70);
  assert.equal(out[2], '  GR3 (global) Rule number 3');
  assert.equal(out[9], '  …and 3 more');
  assert.equal(out[10], '1 paused · project: My Project · /rules to see or change them');
  assert.ok(!out.join('\n').includes('Paused rule'));
  assert.equal(rulebook.summaryText(load(world(t))).split('\n')[0], 'CC Rules: no active rules.');
});

test('contextText gives Claude the levels, precedence, active rules and command line', (t) => {
  const { state } = threeLevels(t);
  const text = rulebook.contextText(state, '"node" "rules.js" --session x');
  assert.match(text, /- GR1 \(global rules\): Use a \| b/);
  assert.match(text, /- PR1 \(project "Apps"\): Use metric units/);
  assert.match(text, /- CR1 \(this chat\): Keep replies short/);
  assert.match(text, /Paused, do not follow: GR2/);
  assert.ok(!text.includes('Secret paused text'));
  assert.match(text, /the higher level wins: global over project, project over this chat/);
  assert.match(text, /project "Apps" \(the sidebar group this chat is filed under\)/);
  assert.match(text, /"node" "rules.js" --session x <command>/);
});
