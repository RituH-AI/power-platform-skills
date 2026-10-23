'use strict';
// The generated call of a built-in Dataverse operation, as the evaluator reads a page's source (action-binding-union.js builtInRuntimeProblems).
//
// The reference is the pattern plugins/model-apps/references/dataverse-operations.md teaches — read from that document, so the document and the
// evaluator cannot drift apart. It must pass; and each departure the reference forbids must fail, with the problem that names it: a call on mount
// or at render, a partial identity, a spread or serialized result, a member read, a read from the root or `res.value`, outputs read before
// `res.ok`, no object check for an empty answer, an unbounded Version, raw fault text, a status read out of the message, a message that says to
// deploy a Custom API, a pre-dispatch check that does not return, extra request fields, no disabled button, one shared pending state, no stale
// request guard, no catch, and a logged result. A whole built-in-only lifecycle through the Phase 5 evaluator passes with it too.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { builtInRuntimeProblems } = require('../lib/action-binding-union.js');
const { PHASE_EXPECTATIONS } = require('../lib/assertions-layer-1.js');
const { PHASE5_EXPECTATIONS } = require('../lib/assertions-layer-2.js');
const { getDataverseOperationCatalogue } = require('../../../../plugins/model-apps/scripts/lib/dataverse-operations.js');

const DOC = path.join(__dirname, '..', '..', '..', '..', 'plugins', 'model-apps', 'references', 'dataverse-operations.md');
const REFERENCE = (() => {
  const text = fs.readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n');
  const section = text.slice(text.indexOf('\n## Generated call\n'));
  const block = /```tsx\n([\s\S]*?)\n```/.exec(section);
  assert.ok(block, 'the reference document holds the generated call');
  return `${block[1]}\n`;
})();
const BOTH = ['WhoAmI', 'RetrieveVersion'];
const problems = (source, names = BOTH) => builtInRuntimeProblems(source, names);

// One textual change to the reference; a change that does not apply is a broken test, not a pass.
function mutated(find, replace) {
  assert.ok(REFERENCE.includes(find), `the reference holds: ${find}`);
  return REFERENCE.replace(find, replace);
}

test('the reference pattern of the document passes, for each operation alone and for both', () => {
  assert.deepStrictEqual(problems(REFERENCE), []);
  assert.deepStrictEqual(problems(REFERENCE, ['WhoAmI']), []);
  assert.deepStrictEqual(problems(REFERENCE, ['RetrieveVersion']), []);
});

test('a call that is not the user\'s — on mount, at render, on a timer, in a memo, or a retry of itself — fails', () => {
  for (const [label, source, reason] of [
    ['an effect calls it', mutated('React.useEffect(() => () => { mounted.current = false; }, []);', 'React.useEffect(() => { void showIdentity(); return () => { mounted.current = false; }; }, []);'), /effect, a memo or a timer/],
    ['an effect calls the helper', mutated('React.useEffect(() => () => { mounted.current = false; }, []);', 'React.useEffect(() => { void readIdentity(api); return () => { mounted.current = false; }; }, []);'), /effect, a memo or a timer/],
    ['the render calls it', mutated('  return (\n    <div>', '  void readVersion(api);\n  return (\n    <div>'), /while the page renders/],
    ['a timer calls it', mutated('    if (identityPending) return;', '    if (identityPending) return;\n    setTimeout(() => void readIdentity(api), 0);'), /effect, a memo or a timer/],
    ['a memo calls it', mutated('  const identityRequest = React.useRef(0);', '  const identityRequest = React.useRef(0);\n  React.useMemo(() => readIdentity(api), [api]);'), /effect, a memo or a timer/],
    ['it retries itself', mutated("    return { message: res.error?.status === 404 ? UNAVAILABLE : res.error?.message || FAILED };\n  }\n  const outputs = res.outputs;\n  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) return { message: UNEXPECTED };\n  const userId", "    return readIdentity(api);\n  }\n  const outputs = res.outputs;\n  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) return { message: UNEXPECTED };\n  const userId"), /calls itself/],
    ['no button reaches it', mutated('onClick={() => void showVersion()}', 'title="version"'), /not reached from a button/],
  ]) {
    const found = problems(source);
    assert.ok(found.some((p) => reason.test(p)), `${label}: ${JSON.stringify(found)}`);
  }
});

test('outputs are read only after the success check, through own-property reads of a checked object, and shown all or nothing', () => {
  for (const [label, source, reason] of [
    ['a partial identity', mutated('  if (![userId, businessUnitId, organizationId].every((id) => typeof id === \'string\' && GUID.test(id))) return { message: UNEXPECTED };\n', '  if (!userId || !GUID.test(userId)) return { message: UNEXPECTED };\n'), /all or none/],
    ['the identity is never tested', mutated('  if (![userId, businessUnitId, organizationId].every((id) => typeof id === \'string\' && GUID.test(id))) return { message: UNEXPECTED };\n', ''), /all or none/],
    ['no object check (an empty or 204 answer)', mutated("  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) return { message: UNEXPECTED };\n  const userId", '  const userId'), /non-null, non-array object/],
    ['a member read', mutated("const userId = ownString(outputs, 'UserId');", 'const userId = outputs.UserId as string | undefined;'), /as a member/],
    ['a destructured read', mutated("const version = ownString(outputs, 'Version');", 'const { Version: version } = outputs as { Version?: string };'), /as a member/],
    ['a read from the result root', mutated("const userId = ownString(outputs, 'UserId');", "const userId = (res as unknown as { UserId?: string }).UserId ?? ownString(outputs, 'UserId');"), /from the result root/],
    ['a spread of outputs', mutated('  return { version };', '  return { version, ...outputs };'), /spread, iterated or serialized/],
    ['a serialized result', mutated('  return { version };', '  return { version: JSON.stringify(res.outputs) };'), /spread, iterated or serialized/],
    ['an unbounded Version', mutated('  if (!version || version.length > 128) return { message: UNEXPECTED };', '  if (!version) return { message: UNEXPECTED };'), /1 to 128 characters/],
    ['an empty Version shown', mutated('  if (!version || version.length > 128) return { message: UNEXPECTED };', '  if (version === undefined || version.length > 128) return { message: UNEXPECTED };'), /1 to 128 characters/],
    ['no unexpected-shape sentence', REFERENCE.replace('The operation returned an unexpected response. No result was displayed.', 'Something went wrong.'), /unexpected shape must say/],
  ]) {
    const found = problems(source);
    assert.ok(found.some((p) => reason.test(p)), `${label}: ${JSON.stringify(found)}`);
  }
});

test('a failure shows only sanitized text: no stack, no status read out of the message, no advice to deploy a Custom API', () => {
  for (const [label, source, reason] of [
    ['a stack', mutated('      if (mounted.current && requestId === identityRequest.current) setIdentity({ message: FAILED });', '      if (mounted.current && requestId === identityRequest.current) setIdentity({ message: String((error as Error).stack) });').replace('    } catch {\n      if (mounted.current && requestId === identityRequest.current) setIdentity({ message: String', '    } catch (error) {\n      if (mounted.current && requestId === identityRequest.current) setIdentity({ message: String'), /stack/],
    ['a status from the words', mutated("    return { message: res.error?.status === 404 ? UNAVAILABLE : res.error?.message || FAILED };\n  }\n  const outputs = res.outputs;\n  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) return { message: UNEXPECTED };\n  const version", "    return { message: res.error?.message?.includes('404') ? UNAVAILABLE : res.error?.message || FAILED };\n  }\n  const outputs = res.outputs;\n  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) return { message: UNEXPECTED };\n  const version"), /message's words/],
    ['a 404 that says to deploy', REFERENCE.replace('The selected operation is unavailable in this environment or player. No fallback was attempted.', 'The selected operation is unavailable. Deploy the Custom API first.'), /deploy a Custom API/],
  ]) {
    const found = problems(source);
    assert.ok(found.some((p) => reason.test(p)), `${label}: ${JSON.stringify(found)}`);
  }
});

test('the request is exactly { name }, and a failed presence check returns before any request', () => {
  for (const [label, source, reason] of [
    ['parameters', mutated("api.executeFunction({ name: 'WhoAmI' })", "api.executeFunction({ name: 'WhoAmI', parameters: {} })"), /exactly \{ name \}/],
    ['boundTo', mutated("api.executeFunction({ name: 'RetrieveVersion' })", "api.executeFunction({ name: 'RetrieveVersion', boundTo: { entityName: 'organization', id: 'x' } })"), /exactly \{ name \}/],
    ['a presence check that does not return', mutated("  if (typeof api.executeFunction !== 'function') return { message: UNSUPPORTED };\n  const res = await api.executeFunction({ name: 'WhoAmI' });", "  if (typeof api.executeFunction !== 'function') console.warn(UNSUPPORTED);\n  const res = await api.executeFunction({ name: 'WhoAmI' });"), /return before any request/],
  ]) {
    const found = problems(source);
    assert.ok(found.some((p) => reason.test(p)), `${label}: ${JSON.stringify(found)}`);
  }
});

test('each button is disabled while its own call is pending, ignores a stale answer, catches a rejection, and nothing of the result is logged or kept', () => {
  for (const [label, source, reason] of [
    ['no disabled button', mutated('<Button disabled={identityPending} onClick={() => void showIdentity()}>', '<Button onClick={() => void showIdentity()}>'), /not disabled while the call is pending/],
    ['one pending state for both', mutated('<Button disabled={versionPending} onClick={() => void showVersion()}>', '<Button disabled={identityPending} onClick={() => void showVersion()}>'), /pending state of its own/],
    ['no stale-request guard', mutated('      if (mounted.current && requestId === identityRequest.current) setIdentity(view);', '      if (mounted.current) setIdentity(view);').replace('    const requestId = ++identityRequest.current;\n    setIdentity({});', '    setIdentity({});').replace('      if (mounted.current && requestId === identityRequest.current) setIdentity({ message: FAILED });', '      if (mounted.current) setIdentity({ message: FAILED });').replace('      if (mounted.current && requestId === identityRequest.current) setIdentityPending(false);', '      if (mounted.current) setIdentityPending(false);'), /stale request/],
    ['no catch', mutated('    } catch {\n      if (mounted.current && requestId === versionRequest.current) setVersion({ message: FAILED });\n    } finally {', '    } finally {'), /not caught/],
    ['a logged result', mutated('      const view = await readIdentity(api);', '      const view = await readIdentity(api);\n      console.log(view);'), /logged, stored, copied or sent/],
    ['a stored result', mutated('  return { version };', '  localStorage.setItem(\'version\', version);\n  return { version };'), /logged, stored, copied or sent/],
  ]) {
    const found = problems(source);
    assert.ok(found.some((p) => reason.test(p)), `${label}: ${JSON.stringify(found)}`);
  }
});

// A page that binds only the two built-ins, through the whole Phase 5 evaluator: create with an enabled built-in gate, the listing and a re-probe.
test('a built-in-only lifecycle with the reference page passes the Phase 5 evaluator in both layers, and the same page reading outputs before success fails', () => {
  const RULE = 'Phase 5: Custom API discovery, gate, bare bindings, runtime calls and update preservation or explicit clear agree';
  const rows = getDataverseOperationCatalogue().operations.map((operation) => ({ name: operation.name, isFunction: true, displayName: operation.displayName, parameterKinds: {} }));
  const fixture = (source) => ({
    contractVersion: 2,
    files: [{ name: 'page.tsx', content: source }],
    artifacts: { 'stages/page.tsx': source, 'actions.json': JSON.stringify(rows), 'created/config.json': JSON.stringify({ actionBindings: rows }) },
    genpagePlan: `## Custom API Bindings
No custom API bindings.

## Dataverse Operations
Verification: environment not-checked, runtime not-checked, privileges not-checked.
| Name | Kind | Bound Entity | Display Name | Parameters | Response fields | Invoke |
|------|------|--------------|--------------|------------|-----------------|--------|
| WhoAmI | Function | (Global) | Current Dataverse identity | (none) | BusinessUnitId, UserId, OrganizationId | button |
| RetrieveVersion | Function | (Global) | Dataverse server version | (none) | Version | button |
`,
    workflowLog: 'Built-in operation create with the gate enabled.',
    manifest: { customApi: { outputs: {}, stages: [{ id: 'create', target: 'page.tsx', source: 'stages/page.tsx', actions: 'actions.json', afterConfig: 'created/config.json', upload: 'create' }] } },
    events: [
      { id: 'custom-api-gate', command: 'node feature-flags.js custom-api', result: 'disabled' },
      { id: 'builtin-gate', command: 'node feature-flags.js dataverse-operations', result: 'enabled' },
      { id: 'listing', command: 'node list-dataverse-operations.js', result: { ok: true, ...structuredClone(getDataverseOperationCatalogue()) } },
      { id: 'builtin-regate', command: 'node feature-flags.js dataverse-operations', result: 'enabled' },
      { id: 'write', command: 'Write page.tsx', artifact: 'stages/page.tsx' },
      { id: 'create', command: 'node genpage-upload.js --code-file page.tsx --actions actions.json --add-to-sitemap', result: { ok: true, pageId: '99999999-9999-4999-8999-999999999999' } },
    ],
  });
  for (const [map, layer] of [[PHASE_EXPECTATIONS, 1], [PHASE5_EXPECTATIONS, 2]]) {
    const good = fixture(REFERENCE);
    const result = map.get(RULE)({ fixture: good, files: good.files, eval: { id: 24 } });
    assert.equal(result.status, 'pass', `layer ${layer}: ${result.reason}`);
  }
  const early = mutated("  if (res.ok !== true) {\n    return { message: res.error?.status === 404 ? UNAVAILABLE : res.error?.message || FAILED };\n  }\n  const outputs = res.outputs;\n  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) return { message: UNEXPECTED };\n  const version", "  const outputs = res.outputs;\n  if (res.ok !== true) {\n    return { message: res.error?.status === 404 ? UNAVAILABLE : res.error?.message || FAILED };\n  }\n  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) return { message: UNEXPECTED };\n  const version");
  const bad = fixture(early);
  const result = PHASE_EXPECTATIONS.get(RULE)({ fixture: bad, files: bad.files, eval: { id: 24 } });
  assert.equal(result.status, 'fail');
  assert.match(result.reason, /RetrieveVersion: response\.ok must refuse before outputs are read/);
  // The pattern is part of the lifecycle verdict: a page that calls WhoAmI from an effect fails the Phase 5 evaluator itself.
  const mounted = fixture(mutated('React.useEffect(() => () => { mounted.current = false; }, []);', 'React.useEffect(() => { void showIdentity(); return () => { mounted.current = false; }; }, []);'));
  for (const map of [PHASE_EXPECTATIONS, PHASE5_EXPECTATIONS]) {
    const verdict = map.get(RULE)({ fixture: mounted, files: mounted.files, eval: { id: 24 } });
    assert.equal(verdict.status, 'fail');
    assert.match(verdict.reason, /WhoAmI: called from an effect, a memo or a timer/);
  }
});
