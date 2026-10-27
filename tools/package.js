'use strict';
// Builds the release archive:
//
//   node tools/package.js [--out DIR]
//
// Checks that the version matches in every manifest, then zips the plugin
// into CCRules_v<version>.zip with everything under a top-level CCRules/
// folder, plus CCRules_v<version>.zip.sha256 beside it. The zip goes next to
// the other release zips in My Programs (the folder above this project) unless
// --out says otherwise. The archive is read back and checked before the file
// list is printed.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createZip, readZip } = require('./zip');

const ROOT = path.resolve(__dirname, '..');
const TOP = 'CCRules';

// Everything that ships. Folders are taken whole.
const INCLUDE = [
  '.claude-plugin',
  'hooks',
  'skills',
  'scripts',
  'types',
  'tests',
  'tools',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'NOTICE',
  'package.json',
];

function fail(message) {
  console.error(`package check failed: ${message}`);
  process.exit(1);
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function walk(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) fail(`missing ${rel}`);
  if (fs.statSync(full).isFile()) return [rel];
  return fs
    .readdirSync(full)
    .sort()
    .flatMap((name) => walk(path.join(rel, name)));
}

function checkVersions() {
  const version = readJson('.claude-plugin/plugin.json').version;
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) fail(`plugin.json version "${version}" isn't x.y.z`);
  const entry = readJson('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'cc-rules');
  if (!entry) fail('marketplace.json has no cc-rules entry');
  if (entry.version !== version) fail(`marketplace.json says ${entry.version}, plugin.json says ${version}`);
  const pkg = readJson('package.json').version;
  if (pkg !== version) fail(`package.json says ${pkg}, plugin.json says ${version}`);
  if (!fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').includes(`## ${version}`)) {
    fail(`CHANGELOG.md has no "## ${version}" section`);
  }
  return version;
}

function main(argv) {
  const outIndex = argv.indexOf('--out');
  const outDir = outIndex === -1 ? path.dirname(ROOT) : path.resolve(argv[outIndex + 1]);
  const version = checkVersions();

  const files = INCLUDE.flatMap(walk).filter((rel) => !rel.endsWith('.tmp'));
  for (const rel of files.filter((f) => f.endsWith('.sh'))) {
    if (fs.readFileSync(path.join(ROOT, rel), 'utf8').includes('\r')) fail(`${rel} has CRLF line endings`);
  }
  const entries = files.map((rel) => ({
    name: `${TOP}/${rel.split(path.sep).join('/')}`,
    data: fs.readFileSync(path.join(ROOT, rel)),
    date: fs.statSync(path.join(ROOT, rel)).mtime,
    executable: rel.endsWith('.sh'),
  }));

  const zip = createZip(entries);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `CCRules_v${version}.zip`);
  fs.writeFileSync(out, zip);

  const back = readZip(fs.readFileSync(out));
  if (back.length !== entries.length) fail('the archive lost entries');
  back.forEach((entry, i) => {
    if (entry.name !== entries[i].name || !entry.data.equals(entries[i].data)) {
      fail(`${entries[i].name} didn't survive the round trip`);
    }
  });

  // Same format as sha256sum, so the download page can show it as is.
  const hash = crypto.createHash('sha256').update(zip).digest('hex');
  fs.writeFileSync(`${out}.sha256`, `${hash}  ${path.basename(out)}\n`);

  for (const entry of entries) console.log(`  ${entry.name} (${entry.data.length} bytes)`);
  console.log(`Wrote ${out}: ${entries.length} files, ${zip.length} bytes`);
  console.log(`SHA-256 ${hash}`);
  return out;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { main };
