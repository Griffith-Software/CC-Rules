'use strict';
// Finding the desktop app's data folder and this chat's record in it.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const desktop = require('../scripts/lib/desktop');
const { SESSION, world, desktopChat, where, write } = require('./helpers');

// A fake app whose data folder is <base>/Claude-Data/claude_test, the layout
// the desktop app uses on Windows since October 2026.
function movedApp(t) {
  const w = world(t);
  const data = path.join(w.base, 'Claude-Data', 'claude_test');
  desktopChat({ ...w, desktop: data }, { title: 'Moved chat', group: 'cg-web' });
  const empty = path.join(w.base, 'empty');
  const env = { ...w.env, CC_RULES_DESKTOP_DIR: '', LOCALAPPDATA: empty, APPDATA: empty };
  return { w, data, env };
}

test('the data folder is found from the Claude Code the app started', (t) => {
  const { data, env } = movedApp(t);
  const execPath = path.join(data, 'claude-code', '2.1.308', 'c17a819afb40', 'claude.exe');
  assert.equal(desktop.appDir({ ...env, CLAUDE_CODE_EXECPATH: execPath }), data);
  assert.equal(desktop.appDirs({ ...env, CLAUDE_CODE_EXECPATH: execPath })[0], data);
});

test('on Windows the Claude-Data folder is searched, then the older locations', { skip: process.platform !== 'win32' && 'Windows only' }, (t) => {
  const { w, data, env } = movedApp(t);
  const local = path.join(w.base);
  const dirs = desktop.appDirs({ ...env, LOCALAPPDATA: local });
  assert.equal(dirs[0], data);
  assert.ok(dirs.includes(path.join(env.APPDATA, 'Claude')), 'the pre-October location is still tried');
  assert.equal(desktop.appDir({ ...env, LOCALAPPDATA: local }), data);
});

test('the chat record named by the app is used, with its group and name', (t) => {
  const { data, env } = movedApp(t);
  const hinted = {
    ...env,
    CLAUDE_CODE_EXECPATH: path.join(data, 'claude-code', '2.1.308', 'x', 'claude.exe'),
    CLAUDE_CODE_SESSION_ID: SESSION,
    CLAUDE_CODE_HOST_SESSION_ID: 'local_1',
    CLAUDE_CODE_ACCOUNT_UUID: 'acct',
    CLAUDE_CODE_ORGANIZATION_UUID: 'org',
  };
  const info = desktop.lookup(SESSION, { env: hinted });
  assert.equal(info.recordFile, path.join(data, 'claude-code-sessions', 'acct', 'org', 'local_1.json'));
  assert.equal(info.configFile, path.join(data, 'claude_desktop_config.json'));
  assert.equal(info.title, 'Moved chat');
  assert.deepEqual(info.group, { id: 'cg-web', name: 'Websites' });
  // A hint naming a folder outside the sessions folder is ignored.
  const bad = desktop.lookup(SESSION, { env: { ...hinted, CLAUDE_CODE_ACCOUNT_UUID: '..' } });
  assert.equal(bad.recordFile, info.recordFile, 'found by the search instead');
});

test('inside the app, a chat whose record cannot be found gets a warning, not silence', (t) => {
  const w = world(t);
  const inApp = { ...w.env, CC_RULES_DESKTOP_DIR: path.join(w.base, 'gone'), CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' };
  const state = where(w, { env: inApp });
  assert.equal(state.project.kind, 'folder');
  assert.deepEqual(state.warnings, [
    "CC Rules couldn't find the desktop app's record of this chat (the app may have moved its files), so this chat uses its folder's project rules.",
  ]);
  // Outside the app (the terminal), no record is normal and says nothing.
  assert.deepEqual(where(w, { env: { ...inApp, CLAUDE_CODE_ENTRYPOINT: 'cli' } }).warnings, []);
});

test('a Claude Code started inside a desktop chat is not warned about the app', (t) => {
  const { w, data, env } = movedApp(t);
  // Variables inherited from the desktop chat it was started in: they name that
  // chat's record, which belongs to another session.
  const inherited = {
    ...env,
    CC_RULES_DESKTOP_DIR: data,
    CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
    CLAUDE_CODE_HOST_SESSION_ID: 'local_1',
    CLAUDE_CODE_ACCOUNT_UUID: 'acct',
    CLAUDE_CODE_ORGANIZATION_UUID: 'org',
  };
  const nested = where(w, { sessionId: 'nested-session', env: inherited });
  assert.deepEqual(nested.warnings, []);
  assert.equal(nested.project.kind, 'folder');
  assert.equal(desktop.lookup('nested-session', { env: inherited }), null);
});

test('a stale hint from the old location falls back to the search', (t) => {
  const { data, env } = movedApp(t);
  write(path.join(data, 'unrelated.txt'), 'x');
  const info = desktop.lookup(SESSION, {
    env: { ...env, CC_RULES_DESKTOP_DIR: data },
    hint: 'C:/Users/someone/AppData/Roaming/Claude/claude-code-sessions/acct/org/local_1.json',
  });
  assert.equal(info.title, 'Moved chat');
});
