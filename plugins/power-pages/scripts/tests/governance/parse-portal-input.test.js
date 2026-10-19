const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  parsePortalInput,
} = require('../../../skills/manage-governance/scripts/parse-portal-input');

const siteId = 'abcdefab-1234-5678-90ab-abcdefabcdef';
const otherId = '11111111-2222-3333-4444-555555555555';

test('parsePortalInput accepts exact IDs and preserves selection syntax', () => {
  assert.deepEqual(parsePortalInput('all'), { policyValue: 'All', portalIds: [], errors: [] });
  assert.deepEqual(parsePortalInput('none'), { policyValue: 'None', portalIds: [], errors: [] });
  for (const [prefix, policyValue] of [['', 'Include'], ['not ', 'Exclude'], ['except ', 'Exclude']]) {
    const result = parsePortalInput(` ${prefix}${siteId.toUpperCase()},\r\n ${otherId}, ${siteId} `, {
      validIds: [siteId, otherId],
    });
    assert.deepEqual(result, { policyValue, portalIds: [siteId, otherId], errors: [] });
  }
  assert.deepEqual(parsePortalInput(` ${siteId} `), {
    policyValue: 'Include', portalIds: [siteId], errors: [],
  });
});

test('parsePortalInput rejects embedded IDs without returning a partial selection', () => {
  const invalidTokens = [
    `please use ${siteId} now`,
    `prefix${siteId}`,
    `${siteId}suffix`,
    `{${siteId}}`,
    `${siteId}.`,
    `${siteId} ${otherId}`,
  ];
  for (const validIds of [undefined, [siteId, otherId]]) {
    for (const token of invalidTokens) {
      for (const prefix of ['', 'not ', 'except ', `${otherId}, `]) {
        const result = parsePortalInput(prefix + token, { validIds });
        assert.equal(result.policyValue, null, prefix + token);
        assert.deepEqual(result.portalIds, [], prefix + token);
        assert.ok(result.errors.length > 0, prefix + token);
      }
    }
  }
});

test('parsePortalInput resolves exact names containing IDs without extracting the ID', () => {
  const name = `Preview ${siteId}`;
  const result = parsePortalInput(name.toUpperCase(), {
    validIds: [{ portalId: otherId, name }],
  });
  assert.deepEqual(result, {
    policyValue: 'Include', portalIds: [otherId], errors: [], resolvedNames: [name],
  });
});

test('parsePortalInput resolves a portal name from an in-memory list', () => {
  const result = parsePortalInput('Portal_1', {
    validIds: [{ portalId: 'portal-id-1', name: 'Portal_1' }],
  });
  assert.deepEqual(result, {
    policyValue: 'Include',
    portalIds: ['portal-id-1'],
    errors: [],
    resolvedNames: ['Portal_1'],
  });
});

test('parse portal CLI accepts list-portals JSON on stdin', () => {
  const script = path.resolve(
    __dirname,
    '../../../skills/manage-governance/scripts/parse-portal-input.js'
  );
  const result = spawnSync(
    process.execPath,
    [script, '--portalsStdin', '--input', 'Portal_1'],
    {
      input: JSON.stringify({
        portals: [{ portalId: 'portal-id-1', name: 'Portal_1' }],
      }),
      encoding: 'utf8',
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).portalIds, ['portal-id-1']);
});

test('parse portal CLI exits with an error for an ID embedded in extra text', () => {
  const script = path.resolve(
    __dirname,
    '../../../skills/manage-governance/scripts/parse-portal-input.js'
  );
  const result = spawnSync(
    process.execPath,
    [script, '--portalsStdin', '--input', `please use ${siteId} now`],
    {
      input: JSON.stringify({ portals: [{ portalId: siteId, name: 'Site 1' }] }),
      encoding: 'utf8',
    }
  );
  assert.equal(result.status, 1, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.policyValue, null);
  assert.deepEqual(parsed.portalIds, []);
  assert.ok(parsed.errors.length > 0);
});
