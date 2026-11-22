'use strict';
// The rules history: every change is recorded, and an old rule number can be
// traced to the rule it meant and what that rule is now.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const rulebook = require('../scripts/lib/rulebook');
const history = require('../scripts/lib/history');
const { SESSION, world, desktopChat, load, write, cli } = require('./helpers');

const actions = (w) => history.readLog(w.home).map((e) => [e.action, e.where, e.was || null, e.id, e.text]);

test('the first look notes what the files hold; later changes are recorded', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  write(w.global, '- [x] GR1: One\n- [x] GR2: Two\n- [x] GR3: Three\n');
  load(w);
  assert.deepEqual(actions(w), [
    ['listed', 'global rules', null, 'GR1', 'One'],
    ['listed', 'global rules', null, 'GR2', 'Two'],
    ['listed', 'global rules', null, 'GR3', 'Three'],
  ]);
  const state = load(w);
  assert.equal(history.readLog(w.home).length, 3, 'nothing changed, nothing added');
  // Each command is recorded when it finishes, as rules.js does.
  for (const change of [
    () => rulebook.addRule(state, { level: 'project', text: 'Four' }),
    () => rulebook.editRule(state, 'GR3', 'Three, reworded'),
    () => rulebook.setActive(state, 'GR2', false),
    () => rulebook.removeRule(state, 'GR1'),
  ]) {
    change();
    rulebook.remember(state);
  }
  assert.deepEqual(actions(w).slice(3), [
    ['add', 'project "Apps"', null, 'PR1', 'Four'],
    ['edit', 'global rules', null, 'GR3', 'Three, reworded'],
    ['pause', 'global rules', null, 'GR2', 'Two'],
    ['remove', 'global rules', null, 'GR1', 'One'],
    ['renumber', 'global rules', 'GR2', 'GR1', 'Two'],
    ['renumber', 'global rules', 'GR3', 'GR2', 'Three, reworded'],
  ]);
});

test('hand edits are recorded at the next load, and a move is one change', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat' });
  write(w.global, '- [x] GR1: One\n- [x] GR2: Two\n');
  load(w);
  write(w.global, '- [x] GR2: Two\n');
  load(w);
  assert.deepEqual(actions(w).slice(2), [
    ['remove', 'global rules', null, 'GR1', 'One'],
    ['renumber', 'global rules', 'GR2', 'GR1', 'Two'],
  ]);
  const r = cli(w, ['move', 'GR1', '--to', 'chat']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(actions(w).slice(4), [['move', 'chat "Chat"', 'GR1', 'CR1', 'Two']]);
});

test('a renamed chat keeps its history', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'First name' });
  rulebook.addRule(load(w), { text: 'Be brief' });
  load(w);
  desktopChat(w, { title: 'Second name' });
  load(w);
  assert.deepEqual(actions(w), [['add', 'chat "First name"', null, 'CR1', 'Be brief']]);
});

test('history <ID> says which rule an old number meant and what it is now', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat' });
  write(w.global, '- [x] GR1: One\n- [x] GR2: Two\n- [x] GR3: Three\n');
  load(w);
  assert.equal(cli(w, ['remove', 'GR1']).code, 0);
  const two = cli(w, ['history', 'GR2']).out.split('\n');
  assert.equal(two[0], 'GR2 in global rules:');
  assert.match(two[1], /^- from the start of history \(.+\) until .+: "Two"$/);
  assert.equal(two[2], '  Now GR1 in global rules: "Two"');
  assert.match(two[3], /^- from .+ to now: "Three" \(it was GR3 before\)$/);
  const one = cli(w, ['history', '1']).out.split('\n');
  assert.match(one[1], /until .+: "One"$/);
  assert.match(one[2], /^ {2}Removed /);
  assert.match(cli(w, ['history', 'GR9']).out, /^GR9 hasn't been used in global rules since history started/);
  const recent = cli(w, ['history']).out;
  assert.match(recent, /^History starts .+\. Changes:\n/);
  assert.match(recent, /global rules {2}removed GR1: One/);
  assert.match(recent, /global rules {2}GR2 is now GR1: Two/);
});

test('project and chat numbers are looked up in this chat\'s project and chat', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  write(path.join(w.projects, 'Apps.md'), 'Linked to project cg-apps.\n- [x] PR1: Apps rule\n');
  load(w);
  assert.match(cli(w, ['history', 'PR1']).out, /^PR1 in project "Apps":\n- from the start of history .+ to now: "Apps rule"$/);
  assert.match(cli(w, ['history', 'CR1']).out, /^CR1 hasn't been used in chat "Chat"/);
});

test('the rules still load when the history can\'t be written', (t) => {
  const w = world(t);
  write(w.global, '- [x] GR1: One\n');
  write(path.join(w.home, 'history-state.json'), '');
  const fs = require('node:fs');
  fs.mkdirSync(path.join(w.home, 'history.jsonl'));
  const state = load(w, { sessionId: SESSION });
  assert.equal(state.global.rules[0].text, 'One');
  assert.match(state.notices.at(-1), /^Couldn't update the rules history: /);
});
