'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readZip, createZip } = require('../tools/zip');
const { PLUGIN, world } = require('./helpers');

test('zip writer round-trips content, names and file modes', () => {
  const entries = [
    { name: 'Top/a.txt', data: Buffer.from('hello\n') },
    { name: 'Top/empty.txt', data: Buffer.alloc(0) },
    { name: 'Top/run.sh', data: Buffer.from('#!/bin/sh\n'), executable: true },
    { name: 'Top/ünï.md', data: Buffer.from('x'.repeat(5000)) },
  ];
  const back = readZip(createZip(entries));
  assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name));
  back.forEach((e, i) => assert.ok(e.data.equals(entries[i].data), e.name));
  assert.equal(back[2].mode, 0o100755);
  assert.equal(back[0].mode, 0o100644);
});

test('package.js builds CCRules_v<version>.zip with everything under CCRules/', (t) => {
  const out = world(t).base;
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'tools', 'package.js'), '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const version = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const zipFile = path.join(out, `CCRules_v${version}.zip`);
  const entries = readZip(fs.readFileSync(zipFile));
  const names = entries.map((e) => e.name);
  assert.ok(names.every((n) => n.startsWith('CCRules/')));
  for (const rel of [
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    'hooks/hooks.json',
    'hooks/panel.tsx',
    'types/index.d.ts',
    'tests/panel.test.tsx',
    'skills/rules/SKILL.md',
    'scripts/rules.js',
    'scripts/session-start.js',
    'scripts/prompt-check.js',
    'scripts/run-node.sh',
    'scripts/lib/rulebook.js',
    'scripts/lib/where.js',
    'scripts/lib/desktop.js',
    'scripts/lib/snapshot.js',
    'tests/rulebook.test.js',
    'README.md',
    'LICENSE',
    'NOTICE',
  ]) {
    const entry = entries.find((e) => e.name === `CCRules/${rel}`);
    assert.ok(entry, rel);
    assert.ok(entry.data.equals(fs.readFileSync(path.join(PLUGIN, rel))), `${rel} matches the file on disk`);
  }
  assert.ok(!names.some((n) => n.endsWith('.zip') || n.includes('/.claude/cc-rules/')));
  assert.equal(entries.find((e) => e.name === 'CCRules/scripts/run-node.sh').mode, 0o100755);
  const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(zipFile)).digest('hex');
  assert.equal(fs.readFileSync(`${zipFile}.sha256`, 'utf8'), `${hash}  CCRules_v${version}.zip\n`);
});
