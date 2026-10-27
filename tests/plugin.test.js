'use strict';
// Checks the plugin's own files: manifests, hook wiring and the /rules skill.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PLUGIN } = require('./helpers');

const readText = (rel) => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));

test('plugin.json names the plugin and declares the Node.js path option', () => {
  const manifest = readJson('.claude-plugin/plugin.json');
  assert.equal(manifest.name, 'cc-rules');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.license, 'SEE LICENSE IN LICENSE');
  assert.equal(manifest.repository, 'https://github.com/Griffith-Software/CC-Rules');
  const option = manifest.userConfig.node_path;
  assert.equal(option.type, 'string');
  // userConfig options are strict: an unknown key stops the plugin loading.
  const allowed = ['type', 'title', 'description', 'required', 'default', 'options', 'multiple', 'sensitive', 'min', 'max'];
  for (const key of Object.keys(option)) assert.ok(allowed.includes(key), key);
});

test('marketplace.json points at this folder with the same version', () => {
  const market = readJson('.claude-plugin/marketplace.json');
  const entry = market.plugins.find((p) => p.name === 'cc-rules');
  assert.equal(entry.source, './');
  assert.equal(entry.version, readJson('.claude-plugin/plugin.json').version);
  assert.equal(readJson('package.json').version, entry.version);
});

test('the panel module and its state contract are wired up', () => {
  assert.deepEqual(readJson('hooks/hooks.json').modules, ['./panel.tsx']);
  assert.ok(fs.existsSync(path.join(PLUGIN, 'hooks', 'panel.tsx')));
  assert.equal(readJson('.claude-plugin/plugin.json').types, './types/index.d.ts');
  assert.match(
    readText('types/index.d.ts'),
    /'cc-rules': \{ view: RulesView \| null; problem: string \| null; hidden: ScanView \| null \}/,
  );
  const panel = readText('hooks/panel.tsx');
  assert.match(panel, /'--no-snapshot'/, 'panel changes still reach Claude at the next message');
  assert.match(panel, /'cc-rules:rules'/, '/rules on its own opens the panel');
  assert.doesNotMatch(panel, /command.register/, 'the /rules skill owns the name');
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'skills/rules-panel')), '/rules-panel was merged into /rules');
});

test('hooks run at chat start and before each message, through the Node launcher', () => {
  const { hooks } = readJson('hooks/hooks.json');
  assert.deepEqual(Object.keys(hooks), ['SessionStart', 'UserPromptSubmit']);
  const scripts = {};
  for (const [event, groups] of Object.entries(hooks)) {
    assert.equal(groups.length, 1);
    assert.equal(groups[0].matcher, undefined, `${event} runs every time`);
    const { command } = groups[0].hooks[0];
    scripts[event] = [...command.matchAll(/"\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/g)].map((m) => m[1]);
    for (const rel of scripts[event]) assert.ok(fs.existsSync(path.join(PLUGIN, rel)), rel);
  }
  assert.deepEqual(scripts.SessionStart, ['scripts/run-node.sh', 'scripts/session-start.js']);
  assert.deepEqual(scripts.UserPromptSubmit, ['scripts/run-node.sh', 'scripts/prompt-check.js']);
  assert.match(hooks.UserPromptSubmit[0].hooks[0].command, /run-node\.sh" --quiet /);
});

test('shell scripts use LF line endings', () => {
  assert.ok(!readText('scripts/run-node.sh').includes('\r'));
});

test('the rules skill is named /rules and covers all three levels', () => {
  const skill = readText('skills/rules/SKILL.md');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(skill.replace(/\r\n/g, '\n'));
  assert.ok(front, 'has front matter');
  assert.match(front[1], /^name: rules$/m);
  const description = /^description: (.*)$/m.exec(front[1])[1];
  for (const phrase of ['make a rule for this chat', 'make a rule for this project', 'make a rule for every chat']) {
    assert.ok(description.includes(phrase), phrase);
  }
  assert.ok(description.length < 1024);
  for (const needle of ['${CLAUDE_SESSION_ID}', '${CLAUDE_PLUGIN_ROOT}', '$ARGUMENTS', 'ask which wins', 'Echo it back', '--level global', 'sidebar group']) {
    assert.ok(skill.includes(needle), needle);
  }
});

test('README, LICENSE, NOTICE and CHANGELOG are present', () => {
  const license = readText('LICENSE');
  assert.match(license, /^"Commons Clause" License Condition v1\.0/);
  assert.match(license, /^Software: CC Rules$/m);
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(readText('NOTICE'), /^CC Rules\n/);
  assert.match(readText('README.md'), /\/rules/);
  const version = readJson('.claude-plugin/plugin.json').version;
  assert.match(readText('CHANGELOG.md'), new RegExp(`## ${version.replace(/\./g, '\\.')}`));
});
