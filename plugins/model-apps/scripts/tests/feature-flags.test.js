'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const libPath = path.join(__dirname, '..', 'lib', 'feature-flags.js');
const lib = require(libPath);
const {
  isEnabled,
  envVarName,
  parseBool,
  describe,
  validateFlags,
  KNOWN_FLAGS,
  FLAGS,
} = lib;

// --- Committed defaults and fail-closed fallback ---------------------------

test('connectors flag is retired and unknown fail-closed', () => {
  const json = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'feature-flags.json'), 'utf8')
  );
  assert.equal(Object.prototype.hasOwnProperty.call(json, 'connectors'), false);
  assert.equal(KNOWN_FLAGS.includes('connectors'), false);
  assert.equal(isEnabled('connectors', { env: { GENPAGE_ENABLE_CONNECTORS: '1' } }), false);
  assert.match(validateFlags({ connectors: true })[0], /unknown flag/i);
  const lib = require(libPath);
  for (const removed of ['isConnectorsEnabled', 'exitIfConnectorsDisabled', 'connectorsDisabledMessage']) {
    assert.equal(lib[removed], undefined, `${removed} must stay removed now that connectors have no flag`);
  }
});
// Custom API support shipped ON in 2.18.0 and 2.19.0 with its platform dependencies live in every region, so the flag was removed (the lifecycle
// in feature-flags.js): Custom API discovery, authoring and upload are always available. As an unknown flag it would now read as disabled, so
// nothing may keep a trace of it that something could still ask for.
test('the custom-api flag is retired: no catalogue entry, no committed key, no helper, and its variable no longer changes anything', () => {
  const json = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'feature-flags.json'), 'utf8')
  );
  assert.equal(Object.prototype.hasOwnProperty.call(json, 'custom-api'), false);
  assert.deepEqual(validateFlags(json), []);
  assert.equal(KNOWN_FLAGS.includes('custom-api'), false);
  assert.equal(FLAGS['custom-api'], undefined);
  for (const value of [undefined, '0', '1']) {
    const env = value === undefined ? {} : { GENPAGE_ENABLE_CUSTOM_API: value };
    assert.equal(isEnabled('custom-api', { env }), false, `unknown flags fail closed, whatever GENPAGE_ENABLE_CUSTOM_API says (${value})`);
  }
  assert.match(validateFlags({ 'custom-api': true })[0], /unknown flag/i);
  for (const removed of ['isCustomApiEnabled', 'exitIfCustomApiDisabled', 'customApiDisabledMessage']) {
    assert.equal(lib[removed], undefined, `${removed} must stay removed now that Custom API support has no flag`);
  }
});

test('feature-flags.js --list shows no custom-api line, and no warning about it, whatever GENPAGE_ENABLE_CUSTOM_API says', () => {
  for (const value of [undefined, '0', '1']) {
    const env = { ...process.env };
    delete env.GENPAGE_ENABLE_CUSTOM_API;
    if (value !== undefined) env.GENPAGE_ENABLE_CUSTOM_API = value;
    const res = spawnSync(process.execPath, [libPath, '--list'], { encoding: 'utf8', env });
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /custom-api/, `GENPAGE_ENABLE_CUSTOM_API=${value}`);
    assert.doesNotMatch(res.stderr, /custom-api/, `GENPAGE_ENABLE_CUSTOM_API=${value}`);
    assert.match(res.stdout, /^custom-telemetry: /m);
    assert.match(res.stdout, /^dataverse-operations: /m);
  }
});

// With the flag gone, a probe left anywhere would read it as disabled and turn Custom API support off where it ran. So nothing the plugin
// ships — a script, a hook, an agent, a skill, a reference, a sample or the plugin's own docs — may still ask for it. The changelog keeps its
// history and the tests name it on purpose; everything else is scanned.
test('nothing the plugin ships asks for the custom-api flag: no script, hook, agent, skill or reference probes it', () => {
  const plugin = path.join(__dirname, '..', '..');
  const probes = [
    /feature-flags\.js["'`]?\s+["'`]?custom-api\b/,
    /isEnabled\(\s*["'`]custom-api["'`]/,
    /\b(?:isCustomApiEnabled|exitIfCustomApiDisabled|customApiDisabledMessage)\b/,
    /GENPAGE_ENABLE_CUSTOM_API\s*=/,
  ];
  const found = [];
  let scanned = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(plugin, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (['node_modules', '.git'].includes(entry.name) || relative === 'scripts/tests') continue;
        walk(full);
      } else if (/\.(?:md|js|cjs|mjs|json|ts|tsx|ps1|sh|ya?ml)$/i.test(entry.name) && relative !== 'CHANGELOG.md') {
        scanned += 1;
        const text = fs.readFileSync(full, 'utf8');
        for (const probe of probes) if (probe.test(text)) found.push(`${relative}: ${probe}`);
      }
    }
  };
  walk(plugin);
  assert.ok(scanned > 100, `scanned ${scanned} files`);
  assert.deepEqual(found, []);
});

test('custom-telemetry flag is OFF by default (no env override)', () => {
  // custom-telemetry has no helper of its own (it gates code generation, not scripts), so
  // the generic probe is the contract the skill markdown actually calls.
  assert.equal(isEnabled('custom-telemetry', { env: {} }), false);
});

test('unknown flags are OFF (fail-closed)', () => {
  assert.equal(isEnabled('does-not-exist', { env: {} }), false);
});

test('missing/invalid flags file is treated as all-OFF', () => {
  assert.equal(
    isEnabled('custom-telemetry', { env: {}, flagsPath: path.join(__dirname, 'no-such-flags.json') }),
    false
  );
});

// --- Env override precedence (env wins over committed config) ----------------

test('env var enables a flag that is false in config', () => {
  assert.equal(
    isEnabled('custom-telemetry', { env: { GENPAGE_ENABLE_CUSTOM_TELEMETRY: '1' }, flags: { 'custom-telemetry': false } }),
    true
  );
});

test('env var OFF overrides config true', () => {
  assert.equal(
    isEnabled('custom-telemetry', { env: { GENPAGE_ENABLE_CUSTOM_TELEMETRY: '0' }, flags: { 'custom-telemetry': true } }),
    false
  );
});

test('unrecognized env value defers to config', () => {
  assert.equal(
    isEnabled('custom-telemetry', { env: { GENPAGE_ENABLE_CUSTOM_TELEMETRY: 'maybe' }, flags: { 'custom-telemetry': true } }),
    true
  );
});

test('config true enables when env is unset', () => {
  assert.equal(isEnabled('custom-telemetry', { env: {}, flags: { 'custom-telemetry': true } }), true);
});

// --- Helpers ----------------------------------------------------------------

test('envVarName maps flag names to GENPAGE_ENABLE_<FLAG>', () => {
  assert.equal(envVarName('custom-telemetry'), 'GENPAGE_ENABLE_CUSTOM_TELEMETRY');
  assert.equal(envVarName('multi-word flag'), 'GENPAGE_ENABLE_MULTI_WORD_FLAG');
});

test('parseBool recognizes common truthy/falsey tokens, defers otherwise', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' On ']) assert.equal(parseBool(v), true, `truthy: ${v}`);
  for (const v of ['0', 'false', 'no', 'off', 'OFF']) assert.equal(parseBool(v), false, `falsey: ${v}`);
  for (const v of [undefined, null, '', '   ', 'maybe']) assert.equal(parseBool(v), null, `defer: ${String(v)}`);
});

// --- Committed config keeps each feature's own default ---------------------

test('committed feature-flags.json ships custom-telemetry: false', () => {
  const json = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'feature-flags.json'), 'utf8')
  );
  assert.equal(json['custom-telemetry'], false);
});

// --- CLI probe (deterministic gate for the skill markdown) ------------------

test('CLI prints "disabled" and exits 1 for an explicit opt-out', () => {
  const res = spawnSync(process.execPath, [libPath, 'custom-telemetry'], {
    encoding: 'utf8',
    env: { ...process.env, GENPAGE_ENABLE_CUSTOM_TELEMETRY: '0' },
  });
  assert.equal(res.status, 1);
  assert.match(res.stdout, /disabled/);
});

test('CLI prints "enabled" and exits 0 when env override ON', () => {
  const res = spawnSync(process.execPath, [libPath, 'custom-telemetry'], {
    encoding: 'utf8',
    env: { ...process.env, GENPAGE_ENABLE_CUSTOM_TELEMETRY: '1' },
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /enabled/);
});

test('CLI prints "disabled" and exits 1 for the retired custom-api flag, even with its old variable set', () => {
  for (const value of [undefined, '1']) {
    const env = { ...process.env };
    delete env.GENPAGE_ENABLE_CUSTOM_API;
    if (value !== undefined) env.GENPAGE_ENABLE_CUSTOM_API = value;
    const res = spawnSync(process.execPath, [libPath, 'custom-api'], { encoding: 'utf8', env });
    assert.equal(res.status, 1, res.stderr);
    assert.equal(res.stdout, 'disabled\n');
  }
});

test('CLI without a flag name exits 2 with usage', () => {
  const res = spawnSync(process.execPath, [libPath], { encoding: 'utf8' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Usage:/);
});

// --- known-flag registry + describe() + validation --------------------------

test('KNOWN_FLAGS includes custom-telemetry', () => {
  assert.ok(KNOWN_FLAGS.includes('custom-telemetry'));
});

test('describe reports effective state and source per known flag', () => {
  const envOn = describe({ env: { GENPAGE_ENABLE_CUSTOM_TELEMETRY: '1' }, flags: { 'custom-telemetry': false } });
  const c1 = envOn.find((f) => f.flag === 'custom-telemetry');
  assert.equal(c1.enabled, true);
  assert.equal(c1.source, 'env');

  const fileOn = describe({ env: {}, flags: { 'custom-telemetry': true } });
  const c2 = fileOn.find((f) => f.flag === 'custom-telemetry');
  assert.equal(c2.enabled, true);
  assert.equal(c2.source, 'file');

  const dflt = describe({ env: {}, flags: {} });
  const c3 = dflt.find((f) => f.flag === 'custom-telemetry');
  assert.equal(c3.enabled, false);
  assert.equal(c3.source, 'default');
});

test('validateFlags warns on unknown keys and non-boolean values, ignores _comment', () => {
  assert.deepEqual(validateFlags({ 'custom-telemetry': false, _comment: 'x' }), []);
  assert.match(validateFlags({ 'custom-telemetri': true })[0], /unknown flag/i);
  assert.match(validateFlags({ 'custom-telemetry': 'yes' })[0], /boolean/i);
});

// --- flag catalog: status tracking for experimental / in-progress features --

test('FLAGS catalog documents custom-telemetry with a status and summary', () => {
  assert.ok(FLAGS['custom-telemetry'], 'custom-telemetry flag should be in the catalog');
  assert.ok(['experimental', 'in-progress', 'ga'].includes(FLAGS['custom-telemetry'].status));
  assert.match(FLAGS['custom-telemetry'].summary, /telemetry|Application Insights/i);
  assert.ok(FLAGS['custom-telemetry'].dependencies, 'should document what it depends on');
  assert.match(FLAGS['custom-telemetry'].enableEnv, /GENPAGE_ENABLE_CUSTOM_TELEMETRY/);
});

test('KNOWN_FLAGS is derived from the FLAGS catalog', () => {
  assert.deepEqual(KNOWN_FLAGS, Object.keys(FLAGS));
});

test('describe includes the status for each known flag', () => {
  const d = describe({ env: {}, flags: {} });
  for (const flag of KNOWN_FLAGS) assert.equal(d.find((f) => f.flag === flag).status, FLAGS[flag].status, flag);
});

// --- dataverse-operations: its own default-OFF gate, which never decides Custom API support ------------------

const DATAVERSE_OPERATIONS_LINE = 'Dataverse built-in operation authoring is disabled (feature flag "dataverse-operations" is OFF). '
  + 'Set GENPAGE_ENABLE_DATAVERSE_OPERATIONS=1 to offer WhoAmI and RetrieveVersion. '
  + 'Existing bindings are preserved; runtime governance and user privileges still apply.';

test('dataverse-operations is a registered flag: its env override turns it on, and the retired custom-api variable decides nothing', () => {
  // An unregistered flag ignores its env var (isEnabled fails closed for unknown names), so registration is what this pins.
  assert.equal(isEnabled('dataverse-operations', { env: { GENPAGE_ENABLE_DATAVERSE_OPERATIONS: '1' } }), true);
  assert.ok(KNOWN_FLAGS.includes('dataverse-operations'));
  assert.equal(FLAGS['dataverse-operations'].status, 'experimental');
  assert.equal(FLAGS['dataverse-operations'].enableEnv, 'GENPAGE_ENABLE_DATAVERSE_OPERATIONS=1');
  assert.match(FLAGS['dataverse-operations'].summary, /WhoAmI/);
  assert.match(FLAGS['dataverse-operations'].summary, /RetrieveVersion/);
  assert.equal(envVarName('dataverse-operations'), 'GENPAGE_ENABLE_DATAVERSE_OPERATIONS');
  // The retired custom-api variable is no switch for this flag either way.
  assert.equal(isEnabled('dataverse-operations', { env: { GENPAGE_ENABLE_CUSTOM_API: '1' } }), false);
  assert.equal(isEnabled('dataverse-operations', { env: { GENPAGE_ENABLE_CUSTOM_API: '0', GENPAGE_ENABLE_DATAVERSE_OPERATIONS: '1' } }), true);
});

test('dataverse-operations ships OFF; an unset, blank or unrecognized env value defers to the file, which is not a forced false', () => {
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'feature-flags.json'), 'utf8'));
  assert.equal(json['dataverse-operations'], false);
  assert.deepEqual(validateFlags(json), []);
  assert.equal(isEnabled('dataverse-operations', { env: {} }), false);
  for (const value of [undefined, '', '   ', 'maybe', 'enable']) {
    const env = value === undefined ? {} : { GENPAGE_ENABLE_DATAVERSE_OPERATIONS: value };
    assert.equal(isEnabled('dataverse-operations', { env, flags: {} }), false, `${JSON.stringify(value)} over a file without the flag`);
    assert.equal(isEnabled('dataverse-operations', { env, flags: { 'dataverse-operations': true } }), true, `${JSON.stringify(value)} defers to a file that says true`);
  }
  for (const value of ['0', 'false', 'NO', ' off ']) {
    assert.equal(isEnabled('dataverse-operations', { env: { GENPAGE_ENABLE_DATAVERSE_OPERATIONS: value }, flags: { 'dataverse-operations': true } }), false, value);
  }
  for (const value of ['1', 'true', 'YES', ' on ']) {
    assert.equal(isEnabled('dataverse-operations', { env: { GENPAGE_ENABLE_DATAVERSE_OPERATIONS: value }, flags: {} }), true, value);
  }
  assert.equal(isEnabled('dataverse-operations', { env: {}, flags: { 'dataverse-operations': 'true' } }), false, 'only a boolean true in the file turns it on');
  assert.equal(isEnabled('dataverse-operations', { env: {}, flagsPath: path.join(__dirname, 'no-such-flags.json') }), false, 'a missing file stays off');
  const listed = describe({ env: {}, flags: {} }).find((f) => f.flag === 'dataverse-operations');
  assert.deepEqual(listed, { flag: 'dataverse-operations', enabled: false, source: 'default', status: 'experimental' });
});

test('the dataverse-operations helpers print the one byte-stable gate line and exit 3', () => {
  assert.equal(lib.dataverseOperationsDisabledMessage(), DATAVERSE_OPERATIONS_LINE);
  assert.equal(lib.isDataverseOperationsEnabled({ env: {} }), false);
  assert.equal(lib.isDataverseOperationsEnabled({ env: { GENPAGE_ENABLE_DATAVERSE_OPERATIONS: 'on' } }), true);
  let exitCode = null;
  let written = '';
  lib.exitIfDataverseOperationsDisabled({ env: {}, flags: {}, exit: (c) => { exitCode = c; }, write: (s) => { written += s; } });
  assert.equal(exitCode, 3);
  assert.equal(written, `${DATAVERSE_OPERATIONS_LINE}\n`);
  let touched = false;
  lib.exitIfDataverseOperationsDisabled({ env: { GENPAGE_ENABLE_DATAVERSE_OPERATIONS: '1' }, exit: () => { touched = true; }, write: () => { touched = true; } });
  assert.equal(touched, false, 'ON is a no-op');
});

test('CLI probe: dataverse-operations prints "disabled" and exits 1 by default, "enabled" and 0 with the override; usage stays exit 2', () => {
  const env = { ...process.env };
  delete env.GENPAGE_ENABLE_DATAVERSE_OPERATIONS;
  const off = spawnSync(process.execPath, [libPath, 'dataverse-operations'], { encoding: 'utf8', env });
  assert.equal(off.status, 1, off.stderr);
  assert.equal(off.stdout, 'disabled\n');
  const on = spawnSync(process.execPath, [libPath, 'dataverse-operations'], { encoding: 'utf8', env: { ...env, GENPAGE_ENABLE_DATAVERSE_OPERATIONS: '1' } });
  assert.equal(on.status, 0, on.stderr);
  assert.equal(on.stdout, 'enabled\n');
  const usage = spawnSync(process.execPath, [libPath], { encoding: 'utf8', env });
  assert.equal(usage.status, 2);
});
