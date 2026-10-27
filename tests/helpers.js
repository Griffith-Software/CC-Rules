'use strict';
// Shared test helpers. Every test gets its own throwaway "world": a chat
// folder, a rules home, a fake desktop app and a fake Claude config folder,
// so nothing ever touches the real ~/.claude or desktop app settings.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolve } = require('../scripts/lib/where');
const rulebook = require('../scripts/lib/rulebook');

const PLUGIN = path.resolve(__dirname, '..');
const CLI = path.join(PLUGIN, 'scripts', 'rules.js');
const SESSION_START = path.join(PLUGIN, 'scripts', 'session-start.js');
const PROMPT_CHECK = path.join(PLUGIN, 'scripts', 'prompt-check.js');
const SESSION = '11111111-2222-3333-4444-555555555555';
const GROUPS = [
  { id: 'cg-apps', name: 'Apps' },
  { id: 'cg-web', name: 'Websites' },
];

function world(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-rules-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const w = {
    base,
    root: path.join(base, 'My Project'),
    home: path.join(base, 'home'),
    desktop: path.join(base, 'desktop'),
    claude: path.join(base, 'claude'),
  };
  fs.mkdirSync(w.root, { recursive: true });
  w.env = {
    CC_RULES_HOME: w.home,
    CC_RULES_DESKTOP_DIR: w.desktop,
    CLAUDE_CONFIG_DIR: w.claude,
    CLAUDE_PROJECT_DIR: '',
    // Tests run from a desktop app chat would otherwise inherit these and
    // look at the real app.
    CLAUDE_CODE_ENTRYPOINT: '',
    CLAUDE_CODE_EXECPATH: '',
    CLAUDE_CODE_HOST_SESSION_ID: '',
    CLAUDE_CODE_SESSION_ID: '',
  };
  w.global = path.join(w.home, 'GLOBAL.md');
  w.folderProject = path.join(w.root, '.claude', 'cc-rules', 'PROJECT.md');
  w.projects = path.join(w.home, 'projects');
  w.chats = path.join(w.home, 'chats');
  return w;
}

// Makes the chat a desktop app chat with this name, filed under `group` (an
// ID from `groups`, or none).
function desktopChat(w, { sessionId = SESSION, local = 'local_1', title = null, group = null, groups = GROUPS, record = {} } = {}) {
  const dir = path.join(w.desktop, 'claude-code-sessions', 'acct', 'org');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${local}.json`), JSON.stringify({ sessionId: local, cliSessionId: sessionId, title, ...record }));
  const configFile = path.join(w.desktop, 'claude_desktop_config.json');
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch {
    // first chat
  }
  const scopes = (((config.preferences ||= {}).epitaxyPrefs ||= {})['dframe-group-scopes'] ||= {});
  const scope = (scopes['acct/org'] ||= { groups: [], assignments: {} });
  scope.groups = groups;
  if (group) scope.assignments[`code:${local}`] = group;
  else delete scope.assignments[`code:${local}`];
  fs.writeFileSync(configFile, JSON.stringify(config));
}

function where(w, opts = {}) {
  return resolve({ sessionId: SESSION, cwd: w.root, env: { ...w.env }, ...opts });
}

function load(w, opts = {}) {
  return rulebook.load(where(w, opts));
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function exists(file) {
  return fs.existsSync(file);
}

function list(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function run(script, args, w, { input, env } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...w.env, ...env },
  });
  return { code: result.status, out: result.stdout.trim(), err: result.stderr.trim() };
}

function cli(w, args, { input, session = SESSION, env } = {}) {
  const base = ['--root', w.root];
  if (session) base.push('--session', session);
  return run(CLI, [...base, ...args], w, { input, env });
}

// Runs a hook script with JSON input and returns its parsed output (or null
// when it printed nothing).
function hook(script, w, input, env) {
  const r = run(script, [], w, { input: typeof input === 'string' ? input : JSON.stringify(input), env });
  if (r.code !== 0) throw new Error(`hook exited ${r.code}: ${r.err}`);
  return r.out ? JSON.parse(r.out) : null;
}

function findOnPath(name) {
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

module.exports = {
  PLUGIN,
  CLI,
  SESSION_START,
  PROMPT_CHECK,
  SESSION,
  world,
  desktopChat,
  where,
  load,
  write,
  read,
  exists,
  list,
  cli,
  hook,
  findOnPath,
};
