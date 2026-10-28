'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snapshot = require('../scripts/lib/snapshot');
const { SESSION, world, desktopChat, load, write } = require('./helpers');

const APPS = { kind: 'group', id: 'cg-apps', name: 'Apps' };
const rule = (id, level, text, active = true) => ({ id, level, active, text });

const base = {
  project: APPS,
  rules: [
    rule('GR1', 'global', 'One'),
    rule('GR2', 'global', 'Two'),
    rule('GR3', 'global', 'Gone'),
    rule('PR1', 'project', 'Proj'),
    rule('CR1', 'chat', 'Three', false),
  ],
  notices: [],
};

test('changes lists what is different, in plain words', () => {
  assert.deepEqual(snapshot.changes(base, base), []);
  const after = {
    project: APPS,
    rules: [
      rule('GR1', 'global', 'One, reworded', false),
      rule('GR2', 'global', 'Three'),
      rule('GR3', 'global', 'Two'),
      rule('PR1', 'project', 'Proj'),
      rule('PR2', 'project', 'Five'),
      rule('CR1', 'chat', 'Six', false),
    ],
  };
  assert.deepEqual(snapshot.changes(base, after), [
    'GR1 (global) now says: One, reworded',
    'GR1 (global) paused',
    'CR1 moved from this chat to global and is now GR2',
    'GR2 (global) resumed',
    'PR2 (project) now applies: Five',
    'CR1 (this chat) was added, paused: Six',
    'GR3 (global) no longer applies: Gone',
    'Global rules renumbered: GR2 is now GR3.',
  ]);
  const renamed = { ...base, project: { ...APPS, name: 'Applications' } };
  assert.deepEqual(snapshot.changes(base, renamed), ['Project "Apps" is now called "Applications".']);
});

test('after a move to another project, the same ID is a different rule', () => {
  const before = { project: APPS, rules: [rule('PR1', 'project', 'Apps rule')] };
  const after = { project: { kind: 'group', id: 'cg-web', name: 'Websites' }, rules: [rule('PR1', 'project', 'Web rule')] };
  assert.deepEqual(snapshot.changes(before, after), [
    'This chat is now in project "Websites".',
    'PR1 (project) now applies: Web rule',
    'PR1 (project) no longer applies: Apps rule',
  ]);
});

test('IDs from before 1.1.0 are reported as renumbered', () => {
  const before = {
    project: APPS,
    rules: [rule('R1', 'global', 'One'), rule('R2', 'global', 'Two'), rule('R3', 'global', 'Three'), rule('R5', 'global', 'Five'), rule('R4', 'project', 'Proj')],
  };
  const after = {
    project: APPS,
    rules: [rule('GR1', 'global', 'One'), rule('GR2', 'global', 'Two'), rule('GR3', 'global', 'Three'), rule('GR4', 'global', 'Five'), rule('PR1', 'project', 'Proj')],
  };
  assert.deepEqual(snapshot.changes(before, after), [
    'Global rules renumbered: R1–R3 are now GR1–GR3, R5 is now GR4.',
    'Project rules renumbered: R4 is now PR1.',
  ]);
});

test('newNotices skips notices that were already shown', () => {
  assert.deepEqual(snapshot.newNotices({ notices: ['a'] }, { notices: ['a', 'b'] }), ['b']);
  assert.deepEqual(snapshot.newNotices(null, { notices: ['a'] }), ['a']);
});

test('capture, write and read round-trip, and prune drops old snapshots', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  write(w.global, '- [x] GR1: One\n');
  const snap = snapshot.capture(load(w));
  assert.deepEqual(snap.project, APPS);
  assert.equal(snap.chatTitle, 'Chat');
  assert.deepEqual(snap.rules, [rule('GR1', 'global', 'One')]);
  snapshot.write(w.home, SESSION, snap);
  assert.deepEqual(snapshot.read(w.home, SESSION), JSON.parse(JSON.stringify(snap)));

  const file = path.join(w.home, '.state', `${SESSION}.json`);
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(file, old, old);
  snapshot.prune(w.home, 30);
  assert.equal(snapshot.read(w.home, SESSION), null);
});
