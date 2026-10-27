'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snapshot = require('../scripts/lib/snapshot');
const { SESSION, world, desktopChat, load, write } = require('./helpers');

const base = {
  project: { kind: 'group', id: 'cg-apps', name: 'Apps' },
  rules: [
    { id: 'R1', level: 'global', active: true, text: 'One' },
    { id: 'R2', level: 'project', active: true, text: 'Two' },
    { id: 'R3', level: 'chat', active: false, text: 'Three' },
  ],
  notices: [],
};

test('changes lists what is different, in plain words', () => {
  assert.deepEqual(snapshot.changes(base, base), []);
  const after = {
    project: { kind: 'group', id: 'cg-web', name: 'Websites' },
    rules: [
      { id: 'R1', level: 'global', active: false, text: 'One, reworded' },
      { id: 'R3', level: 'global', active: true, text: 'Three' },
      { id: 'R5', level: 'project', active: true, text: 'Five' },
      { id: 'R6', level: 'chat', active: false, text: 'Six' },
    ],
  };
  assert.deepEqual(snapshot.changes(base, after), [
    'This chat is now in project "Websites".',
    'R1 (global) now says: One, reworded',
    'R1 (global) paused',
    'R3 moved from this chat to global',
    'R3 (global) resumed',
    'R5 (project) now applies: Five',
    'R6 (this chat) was added, paused: Six',
    'R2 (project) no longer applies',
  ]);
  const renamed = { ...base, project: { kind: 'group', id: 'cg-apps', name: 'Applications' } };
  assert.deepEqual(snapshot.changes(base, renamed), ['Project "Apps" is now called "Applications".']);
});

test('newNotices skips notices that were already shown', () => {
  assert.deepEqual(snapshot.newNotices({ notices: ['a'] }, { notices: ['a', 'b'] }), ['b']);
  assert.deepEqual(snapshot.newNotices(null, { notices: ['a'] }), ['a']);
});

test('capture, write and read round-trip, and prune drops old snapshots', (t) => {
  const w = world(t);
  desktopChat(w, { title: 'Chat', group: 'cg-apps' });
  write(w.global, '- [x] R1: One\n');
  const snap = snapshot.capture(load(w));
  assert.deepEqual(snap.project, { kind: 'group', id: 'cg-apps', name: 'Apps' });
  assert.equal(snap.chatTitle, 'Chat');
  assert.deepEqual(snap.rules, [{ id: 'R1', level: 'global', active: true, text: 'One' }]);
  snapshot.write(w.home, SESSION, snap);
  assert.deepEqual(snapshot.read(w.home, SESSION), JSON.parse(JSON.stringify(snap)));

  const file = path.join(w.home, '.state', `${SESSION}.json`);
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(file, old, old);
  snapshot.prune(w.home, 30);
  assert.equal(snapshot.read(w.home, SESSION), null);
});
