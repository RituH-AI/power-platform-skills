'use strict';
// helpers/own-temp-folder.js: a test file that requires it works in a temp folder of its own inside the temp folder it was given, so the
// folder lib/temp-workspace.js keeps the plugin's workspaces in is that file's alone — and the folder is gone when the file ends, unless a
// test left something in it, which the suite's runner must still see. Each case runs a small test file in a process of its own, as
// `node --test` does, with a temp folder this test made.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { makeTempDir } = require('./helpers/temp-dirs.js');
const { withTempDir } = require('../run-tests.js');
const { workspaceParent } = require('../lib/temp-workspace.js');

const HELPER = path.join(__dirname, 'helpers', 'own-temp-folder.js');
const TEMP_WORKSPACE = path.join(__dirname, '..', 'lib', 'temp-workspace.js');
// `own-temp-<test file>-<six characters>`: the test file is named without `.js`.
const OWN_TEMP = /^own-temp-probe\.test-[A-Za-z0-9]{6}$/;

// A test file that requires the helper first, makes a workspace with the real maker and leaves it to the end of the process, which removes it
// (lib/temp-workspace.js, THE END OF A RUN) — and, when `OWN_TEMP_LEAVE` is set, leaves a file of its own in the temp folder. What it saw is
// written to `OWN_TEMP_REPORT`, outside the temp folder.
const PROBE = [
  "'use strict';",
  `const { ownTemp } = require(${JSON.stringify(HELPER)});`,
  "const test = require('node:test');",
  "const fs = require('node:fs');",
  "const os = require('node:os');",
  "const path = require('node:path');",
  `const { makeTempWorkspace, workspaceParent } = require(${JSON.stringify(TEMP_WORKSPACE)});`,
  "test('a workspace in the plugin folder of this file\\'s own temp folder', () => {",
  "  const workspace = makeTempWorkspace('probe-');",
  "  const env = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };",
  "  fs.writeFileSync(process.env.OWN_TEMP_REPORT, JSON.stringify({ ownTemp, tmpdir: os.tmpdir(), env, parent: workspaceParent(), workspace }));",
  "  if (process.env.OWN_TEMP_LEAVE) fs.writeFileSync(path.join(os.tmpdir(), 'left-behind.txt'), 'a test that forgot to clean up');",
  "});",
  '',
].join('\n');

// Runs the probe with `temp` as its temp folder; answers its exit status and what it reported.
function runProbe(temp, { leave = false } = {}) {
  const dir = makeTempDir('own-temp-probe-');
  const file = path.join(dir, 'probe.test.js');
  const report = path.join(dir, 'report.json');
  fs.writeFileSync(file, PROBE);
  const env = withTempDir(process.env, temp);
  for (const name of Object.keys(env)) if (/^NODE_TEST_CONTEXT$/i.test(name)) delete env[name];
  Object.assign(env, { OWN_TEMP_REPORT: report, POWER_PLATFORM_SKILLS_TELEMETRY_MODEL_APPS_OPTOUT: '1' }, leave ? { OWN_TEMP_LEAVE: '1' } : {});
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, output, seen: fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : null }));
  });
}

test('a test file that requires it works in a folder of its own inside the temp folder it was given, and the folder is gone when the file ends', async () => {
  const temp = makeTempDir('own-temp-given-');
  const { status, output, seen } = await runProbe(temp);
  assert.strictEqual(status, 0, output);
  assert.ok(seen, output);
  assert.strictEqual(path.dirname(seen.ownTemp), temp, 'inside the temp folder the process was given');
  assert.match(path.basename(seen.ownTemp), OWN_TEMP, 'named for the test file');
  assert.deepStrictEqual([seen.tmpdir, seen.env.TEMP, seen.env.TMP, seen.env.TMPDIR], [seen.ownTemp, seen.ownTemp, seen.ownTemp, seen.ownTemp], 'os.tmpdir() and the three variables name it');
  assert.strictEqual(seen.parent, workspaceParent({ os: { tmpdir: () => seen.ownTemp } }), 'the plugin\'s workspace folder is the one in it');
  assert.strictEqual(path.dirname(seen.workspace), seen.parent, 'and the workspace was made there');
  // The end of the process removed the workspace and the plugin's folder (lib/temp-workspace.js), and then this folder: nothing is left.
  assert.deepStrictEqual(fs.readdirSync(temp), []);
});

test('what a test leaves behind keeps the folder, with what was left in it, in the temp folder the runner checks', async () => {
  const temp = makeTempDir('own-temp-given-');
  const { status, output, seen } = await runProbe(temp, { leave: true });
  assert.strictEqual(status, 0, output);
  assert.deepStrictEqual(fs.readdirSync(temp), [path.basename(seen.ownTemp)], 'the folder stays, so the runner names it');
  assert.deepStrictEqual(fs.readdirSync(seen.ownTemp), ['left-behind.txt'], 'with what was left — the workspace and the plugin\'s folder are gone');
});

test('two test files that run at once, given one temp folder, work in two folders of their own', async () => {
  const temp = makeTempDir('own-temp-given-');
  const runs = await Promise.all([runProbe(temp), runProbe(temp)]);
  for (const { status, output } of runs) assert.strictEqual(status, 0, output);
  const [one, two] = runs.map(({ seen }) => seen);
  assert.notStrictEqual(one.ownTemp, two.ownTemp);
  assert.notStrictEqual(one.parent, two.parent, 'so neither can remove the plugin folder the other is making a workspace in');
  assert.deepStrictEqual(fs.readdirSync(temp), []);
});
