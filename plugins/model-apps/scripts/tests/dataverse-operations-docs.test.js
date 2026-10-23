'use strict';
// The documents that teach the agents the two built-in Dataverse operations (WhoAmI, RetrieveVersion) say what the code does — and keep saying it.
//
// The agents act on these words, not on the code: the builder must probe two independent gates (custom-api OFF no longer ends its run or writes []
// over a page's kept bindings), offer only the listing's catalogue and only on an affirmative selection, project the four-key row, and write the
// optional plan section only for a selection of this run; the planners signal and never probe; the orchestrator re-probes before an add/replace
// and halts rather than clearing; the page builder emits a button-only call; download and rebuild relay the not-checked words. The reference
// quotes the fixed sentences the code prints, so a change on either side fails here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AUTHORING_CODES } = require('../lib/dataverse-operations.js');
const { dataverseOperationsDisabledMessage } = require('../lib/feature-flags.js');
const { USAGE, CATALOGUE_UNAVAILABLE } = require('../list-dataverse-operations.js');

const PLUGIN = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(PLUGIN, ...parts), 'utf8').replace(/\r\n/g, '\n');
// Markdown wraps prose at any space; a sentence is looked for with its line breaks and quote markers folded away.
const squash = (text) => text.replace(/\n>\s?/g, '\n').replace(/\s+/g, ' ');
// A document is long: a failed match names the pattern, never prints the whole text.
const has = (text, pattern) => assert.ok(pattern.test(text), `the document says ${pattern}`);
const NOT_CHECKED = 'These are reviewed built-in operation names; their availability in this environment or player and the signed-in user\'s permissions were not checked.';
const NO_WRAPPER = 'This does not mean the environment lacks these operations, and the remedy is not a Custom API wrapper. No new built-in binding was added.';

test('the reference quotes every fixed sentence the code prints: the gate line, the usage and catalogue lines, each authoring code, and the not-checked sentence', () => {
  const reference = squash(read('references', 'dataverse-operations.md'));
  for (const sentence of [dataverseOperationsDisabledMessage(), USAGE, CATALOGUE_UNAVAILABLE, NOT_CHECKED, NO_WRAPPER, ...Object.values(AUTHORING_CODES)]) {
    assert.ok(reference.includes(sentence), `references/dataverse-operations.md quotes: ${sentence}`);
  }
  for (const code of Object.keys(AUTHORING_CODES).filter((key) => key !== 'catalogue_unavailable')) assert.ok(reference.includes(`\`${code}\``), code);
  has(reference, /These are two reviewed built-in Dataverse Functions, not Custom APIs discovered in this environment\. Their availability, player support and your permissions have not been checked\./);
});

test('the reference says why nothing beyond the pair is offered, and that the offer is not a check', () => {
  const reference = squash(read('references', 'dataverse-operations.md'));
  for (const name of ['CalculateRollupField', 'IncrementKnowledgeArticleViewCount', 'QualifyLead']) assert.ok(reference.includes(name), name);
  has(reference, /"Function" or "GET" does not make an operation harmless/);
  has(reference, /Record-bound Functions add overloads/);
  has(reference, /set-bound operations have no invocation shape/);
  has(reference, /Listing is an offer, not a check/);
  has(reference, /a page's first call can answer 404/);
  has(reference, /`genpage-upload\.js --actions` writes the array it is given and resolves no name/);
  has(reference, /2\.17 and 2\.18 do not offer these operations/);
});

test('the builder probes two independent gates — custom-api OFF no longer ends the run or writes [] over kept bindings — and owns the offer, the selection and the one actions.json', () => {
  const builder = squash(read('agents', 'genpage-customapi-builder.md'));
  has(builder, /feature-flags\.js" custom-api node "\$\{PLUGIN_ROOT\}\/scripts\/lib\/feature-flags\.js" dataverse-operations/);
  has(builder, /The two are independent: one being off never stops the other branch, never ends this run early, and never writes `\[\]` over bindings a page keeps\./);
  assert.ok(!/`actions\.json` containing `\[\]`\. Return `custom-api disabled/.test(builder), 'the old early return is gone');
  has(builder, /list-dataverse-operations\.js/);
  has(builder, /Selection is consent; a mention is not\./);
  has(builder, /Never copy `bindingType`, `parameters`, `response`, `outputPrivacy`, `invocation` or `requiresExplicitSelection`/);
  has(builder, /Compose \*\*one\*\* full desired array after both branches have finished — never a partial file/);
  has(builder, /the Custom API rows first, in their existing order, then the new built-in rows in catalogue order/);
  has(builder, /write \*\*nothing\*\* and return the refusal/);
  has(builder, /Write it \*\*only\*\* for a current-run add\/replace/);
  assert.ok(builder.includes(NO_WRAPPER), 'the gate-off sentence for the two names');
  // The Custom API contract it already had stays.
  has(builder, /never copy `lookupParameters` into `actions\.json`/i);
  has(builder, /the working-dir binding file for `genpage-upload\.js --actions`/);
});

test('the planners signal and never probe; the plan section is optional and sits after Custom API Bindings, before Solution Packaging', () => {
  const planner = squash(read('agents', 'genpage-planner.md'));
  has(planner, /"action": "dataverse_operation_discovery_required"/);
  has(planner, /Do \*\*not\*\* probe the `dataverse-operations` flag, run `list-dataverse-operations\.js`, or decide a binding yourself/);
  has(planner, /The `whoAmI` your auth preflight runs is neither signal\./);
  const editPlanner = squash(read('agents', 'genpage-edit-planner.md'));
  has(editPlanner, /"action": "dataverse_operation_discovery_required"/);
  has(editPlanner, /\{ intent, selected, beforeNames, provenance \}/);
  has(editPlanner, /missing preserve evidence is not permission to delete the call/);
  const schema = read('references', 'plan-schema.md');
  const at = (heading) => schema.indexOf(`\n${heading}\n`);
  assert.ok(at('## Custom API Bindings') < at('## Dataverse Operations') && at('## Dataverse Operations') < at('## Solution Packaging'), 'template order');
  has(squash(schema), /OPTIONAL section — present ONLY when this run's genpage-customapi-builder added or replaced a built-in Dataverse operation/);
  has(schema, /\| `## Dataverse Operations` \| Planner, page-builder, orchestrator deploy \(Phase 4\.6b\) \| Optional; absent = no new built-in operation\./);
});

test('the orchestrator dispatches the builder once, re-probes before an add/replace, and halts instead of clearing; the edit flow keeps a preserve away from the gate', () => {
  const skill = squash(read('skills', 'genpage', 'SKILL.md'));
  has(skill, /dispatches that same builder \*\*once\*\* for both needs/);
  has(skill, /### Phase 4\.6b: Built-in Dataverse Operations \(Conditional\)/);
  has(skill, /\*\*If it prints `disabled`:\*\* halt before page generation\. Write no replacement `actions\.json`, pass no `--actions`, and never write `\[\]` in its place/);
  has(skill, /a preserve-only edit never consults this gate/);
  has(skill, /Compare only the \*\*Custom API rows\*\* of `actions\.json` with this table/);
  has(skill, /A file left by an earlier run is not forwarded\./);
  const editFlow = squash(read('skills', 'genpage', 'edit-flow.md'));
  has(editFlow, /\| preserve \(an unrelated edit\) \| not consulted \| omit \|/);
  has(editFlow, /\| none, but the page binds one \| n\/a \| do not pass \| halt/);
  has(editFlow, /`\[\]` is passed only for a confirmed clear-all — never because the `dataverse-operations` gate turned off/);
});

test('the page builder emits a button-only call from the reference, only for the plan\'s table; download, rebuild and /app-builder relay the not-checked words', () => {
  const pageBuilder = squash(read('agents', 'genpage-page-builder.md'));
  has(pageBuilder, /\$\{PLUGIN_ROOT\}\/references\/dataverse-operations\.md/);
  has(pageBuilder, /\*\*button-only\*\* pattern \("Generated call"\)/);
  has(pageBuilder, /never on mount, at render, in a `useEffect`, on a filter or on a timer/);
  has(pageBuilder, /`res\.ok !== true` returns before `res\.outputs` is read/);
  const reference = read('references', 'dataverse-operations.md');
  const pattern = /```tsx\n([\s\S]*?)\n```/.exec(reference.slice(reference.indexOf('## Generated call')))[1];
  assert.ok(!/useEffect\(\(\) => \{[^}]*read(?:Identity|Version)|console\.|localStorage|JSON\.stringify/.test(pattern), 'the reference pattern never calls on mount, logs, stores or serializes');
  has(squash(read('references', 'custom-api.md')), /Two `actionBindings` names are not Custom APIs\.\*\* Exactly `WhoAmI` and `RetrieveVersion`/);
  const appBuilder = squash(read('skills', 'app-builder', 'SKILL.md'));
  has(appBuilder, /`neededInTarget\.dataverseOperations` \(nothing to deploy\)/);
  assert.ok(appBuilder.includes(NOT_CHECKED), 'app-builder relays the rebuild\'s sentence');
  assert.ok(squash(read('references', 'app-spec-schema.md')).includes('`pageBindings.neededInTarget.dataverseOperations`'));
});

test('AGENTS.md lists the third flag OFF, its owner, plan section, gated script and deploy phase', () => {
  const agents = squash(read('AGENTS.md'));
  has(agents, /The remaining flags are `custom-api` \(\*\*ON\*\*\), `custom-telemetry` \(\*\*OFF\*\*\) and `dataverse-operations` \(\*\*OFF\*\*\)\./);
  has(agents, /\| \| `custom-api` \| `custom-telemetry` \| `dataverse-operations` \|/);
  has(agents, /\| \*\*Gated scripts\*\* \| `list-custom-apis\.js` \| none \| `list-dataverse-operations\.js` \|/);
  has(agents, /\| \*\*Deploy phase\*\* \| SKILL Phase 4\.6 \| SKILL Phase 4\.7 \(probe only\) \| SKILL Phase 4\.6b/);
  has(agents, /list-dataverse-operations\.js ← /);
  has(agents, /dataverse-operations\.js ← The reviewed built-in operation catalogue/);
});
