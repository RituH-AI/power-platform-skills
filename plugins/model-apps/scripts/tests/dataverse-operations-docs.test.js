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
  has(reference, /2\.17, 2\.18 and 2\.19 do not offer these operations/);
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
  has(editFlow, /`\[\]` is passed only for a clear-all the maker chose \(the clear choice below\) — never because the `dataverse-operations` gate turned off/);
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

// The text between one heading and the next, so a recipe is looked for in the phase that runs it.
const section = (text, from, to) => {
  const start = text.indexOf(from);
  assert.ok(start !== -1, `the document has ${from}`);
  const end = to ? text.indexOf(to, start + from.length) : text.length;
  assert.ok(end !== -1, `the document has ${to} after ${from}`);
  return squash(text.slice(start, end));
};

test('removing every Custom API keeps the built-in rows — `[]` only clears a page with none, or after a confirmation that names each built-in — in the edit planning and deploy recipes, Phase 6 and the builder', () => {
  const edit = read('skills', 'genpage', 'edit-flow.md');
  const planning = section(edit, '## Edit Phase 3:', '## Edit Phase 4:');
  const deploy = section(edit, '## Edit Phase 6:', '## Edit Phase 7:');
  for (const [phase, text] of [['planning', planning], ['deploy', deploy]]) {
    // The old recipes wrote `[]` for a Custom-API-only intent, which deletes the built-in rows of a mixed page.
    assert.ok(!/\*\*Clear all Custom APIs:\*\* write `\[\]`/.test(text), `${phase}: no [] recipe for clearing the Custom APIs`);
    assert.ok(!/\*\*Remove every Custom API:\*\* write `\[\]`/.test(text), `${phase}: no [] recipe for removing every Custom API`);
    has(text, /\*\*Remove every Custom API:\*\*[^*]*every built-in operation row \(`WhoAmI`, `RetrieveVersion`\) stays, byte for byte/);
    has(text, /\*\*Clear every action binding:\*\*[^*]*only when the page holds no built-in operation row, or after the maker's clear choice naming each one it removes/);
  }
  has(planning, /On a page that binds one, invoke the builder the same way, with the remove intent naming every Custom API row/);
  has(deploy, /never `\[\]` while a built-in row remains/);
  const skill = section(read('skills', 'genpage', 'SKILL.md'), '### Phase 6: Deploy', '**Deploy through `scripts/genpage-upload.js`.**');
  assert.ok(!/write `\[\]` and pass it to clear all `actionBindings`\./.test(skill), 'Phase 6: the unqualified [] clear is gone');
  has(skill, /removing every Custom API keeps them/);
  const builder = section(read('agents', 'genpage-customapi-builder.md'), '## Step 4');
  has(builder, /\*\*Remove every Custom API:\*\* with `custom-api` enabled, drop each Custom API row and keep every built-in row byte for byte/);
  has(builder, /`actions\.json` is `\[\]` only when no row of either kind remains/);
  has(squash(read('agents', 'genpage-edit-planner.md')), /Clearing the Custom APIs of a page that also binds a built-in operation removes each Custom API row and keeps the built-in calls and bindings/);
  has(squash(read('references', 'dataverse-operations.md')), /Removing every Custom API is a remove of each Custom API row: the built-in rows stay, byte for byte/);
});

// A create that binds only built-in operations, followed through the create flow's own words with `custom-api` either way: the Custom API gate
// governs Custom API rows only, both gates come first, then one decision writes and passes the whole array — so the built-in rows are bound.
test('a built-in-only create passes --actions with custom-api ON or OFF: Phase 4.6 governs Custom API rows only, and one decision after both gates writes and passes the array', () => {
  const skill = read('skills', 'genpage', 'SKILL.md');
  const customGate = section(skill, '### Phase 4.6:', '### Phase 4.6b:');
  // custom-api OFF: the sentinel continues, adding no Custom API row — not a ban on the whole actions file.
  assert.ok(!/Do not create or pass `actions\.json`/.test(customGate), 'Phase 4.6 OFF: no ban on the whole actions file');
  assert.ok(!/never add `--actions` on upload/.test(customGate), 'Phase 4.6 OFF: no ban on --actions');
  has(customGate, /\*\*If it prints `disabled`:\*\* Custom API support is OFF\. Add no Custom API row/);
  has(customGate, /only a body of exactly `No custom API bindings\.` continues, with no Custom API rows/);
  // custom-api ON: the sentinel continues with no Custom API rows — not "no actions".
  assert.ok(!/continue with no actions/.test(customGate), 'Phase 4.6 ON: not "no actions"');
  has(customGate, /continue with no Custom API rows only when its body is exactly `No custom API bindings\.`/);
  has(customGate, /This phase governs the Custom API rows only/);
  // Both gates, then one decision.
  const decision = section(skill, '### Phase 4.6c:', '### Phase 4.7:');
  has(decision, /Decide once, after Phase 4\.6 and Phase 4\.6b/);
  has(decision, /the create passes `--actions '<working-dir>\/actions\.json'` whatever `custom-api` printed/);
  has(decision, /a page that binds only built-in operations is created with them bound, with `custom-api` enabled or disabled/);
  has(decision, /\*\*Empty:\*\* the create passes no `--actions`/);
  // The upload follows that decision, not Phase 4.6 alone.
  const deploy = section(skill, '### Phase 6: Deploy', '### Phase 6.5:');
  assert.ok(!/`--actions` line when Phase 4\.6 did not write `actions\.json`/.test(deploy), 'Phase 6: the omission is not keyed to Phase 4.6');
  assert.ok(!/or Phase 4\.6 wrote `<working-dir>\/actions\.json`/.test(deploy), 'Phase 6: passing is not keyed to Phase 4.6');
  has(deploy, /the `--actions` line when Phase 4\.6c decided an empty array/);
  has(deploy, /pass `actions\.json` with `--actions` when Phase 4\.6c decided so/);
  has(deploy, /The same rule applies to `--actions` for the page's `actionBindings` — Custom API and built-in rows alike/);
});

// An edit runs its own eight phases; the create flow's Phase 4.6b is never visited. So the edit flow itself must take the edit planner's signal,
// forward this run's built-in contract through every planner round, and re-probe the gate before it applies an add or replace — the three ways
// a built-in operation arrives in an edit: asked for up front, found in the planner's clarification, and the flag turned off in between.
test('the edit flow handles the built-in signal, forwards this run\'s contract through every planner round, and re-probes the gate before applying an add or replace', () => {
  const edit = read('skills', 'genpage', 'edit-flow.md');
  const intent = section(edit, '## Edit Phase 3:', '## Edit Phase 4:');
  const planning = section(edit, '## Edit Phase 4:', '## Edit Phase 5:');
  const apply = section(edit, '## Edit Phase 5:', '## Edit Phase 6:');
  const deploy = section(edit, '## Edit Phase 6:', '## Edit Phase 7:');
  // Asked for up front: the builder runs before planning, and what it wrote this run goes to the planner.
  assert.ok(!/Phase 4\.6b re-probes it/.test(intent), 'the edit table does not send an edit to the create flow\'s Phase 4.6b');
  has(intent, /\| add \/ replace \| must be ON \(the builder probes it; Edit Phase 4 re-probes it before Edit Phase 5\)/);
  has(intent, /Keep what that dispatch wrote this run — the body of `<working-dir>\/dataverse-operations\.md` and `<working-dir>\/actions\.json` — for the edit planner/);
  has(planning, /The built-in operation contract: the full body of `<working-dir>\/dataverse-operations\.md`, between `----- BEGIN\/END DATAVERSE OPERATIONS -----` delimiters, only when this run's builder wrote it/);
  has(planning, /The `actionBindings` upload file status \(Custom API and built-in rows alike\)/);
  // Found in clarification: the planner's signal is handled here, and the refreshed contract goes back to it.
  has(planning, /\*\*If the planner returns `\{ "action": "dataverse_operation_discovery_required", … \}`\*\*/);
  has(planning, /Dispatch `genpage-customapi-builder` once with \*\*Mode: `edit`\*\*/);
  has(planning, /re-invoke the edit planner with this run's `dataverse-operations\.md` body as the built-in operation contract and `<working-dir>\/actions\.json` as the upload file status/);
  has(planning, /- \*\*`\{ "action": "dataverse_operation_discovery_required", … \}`\*\* — handled above\./);
  // A builder that adds nothing does not send the planner back into the same signal.
  has(planning, /re-invoke the planner with the built-in operation intent `none — not added this run` and no contract, so it plans the edit without that call/);
  has(squash(read('agents', 'genpage-edit-planner.md')), /When your prompt says `none — not added this run`, the builder added none: plan the edit without that call and do not signal again/);
  has(planning, /every prior discovery \(connector, Custom API and built-in operation contracts, and their upload file status; entities\)/);
  // Turned off in between: the edit intent selects a re-probe right before the source is edited, and OFF halts without touching the bindings.
  has(planning, /node "\$\{PLUGIN_ROOT\}\/scripts\/lib\/feature-flags\.js" dataverse-operations/);
  has(planning, /the edit intent, not a plan heading, selects this probe/);
  has(planning, /\*\*If it prints `disabled`:\*\* halt before Edit Phase 5 edits the source\. Write no replacement `actions\.json`, pass no `--actions`, and never write `\[\]` in its place/);
  has(planning, /A preserve, a remove or a confirmed clear never runs this probe/);
  has(apply, /`\$\{PLUGIN_ROOT\}\/references\/dataverse-operations\.md` — when the approved edit adds or replaces a built-in operation/);
  assert.ok(!/Phase 4\.6b halts instead/.test(deploy), 'deploy: the edit\'s own re-probe halts, not the create flow\'s');
  has(deploy, /the Edit Phase 4 re-probe halts instead/);
  has(deploy, /Omit `--actions` when the page's `actionBindings` are unchanged \(Custom API and built-in rows alike\)\./);
  // The create flow routes an edit to these phases and says so.
  const skill = read('skills', 'genpage', 'SKILL.md');
  has(section(skill, '## Edit Flow'), /Edit Phase 4 handles `dataverse_operation_discovery_required`, forwards this run's built-in operation contract through every planner round, and re-probes `dataverse-operations` before an add or replace is applied — the create flow's Phase 4\.6b is not visited/);
  has(section(skill, '#### 1c.', '#### Invocation prompt'), /In an edit, Edit Phase 4 of edit-flow\.md handles this signal/);
  // The edit planner takes the forwarded block as this run's selection; AGENTS.md names the edit's own re-probe.
  has(squash(read('agents', 'genpage-edit-planner.md')), /unless your prompt carries this run's built-in operation contract \(the body of the builder's `dataverse-operations\.md` between `----- BEGIN\/END DATAVERSE OPERATIONS -----` lines\)/);
  has(squash(read('AGENTS.md')), /an edit re-probes in edit-flow\.md, Edit Phase 4/);
});

// A clear of a page that binds a built-in operation deletes it, so its permission is one fixed record the evaluator can tie to the upload it
// covers — the maker's answer to a two-option question, written again right before that upload — never a yes found anywhere in the log.
test('a clear of a page that binds a built-in needs the maker\'s clear choice, recorded again right before each upload it covers — never a yes to adding or keeping one', () => {
  const edit = read('skills', 'genpage', 'edit-flow.md');
  const deploy = section(edit, '## Edit Phase 6:', '## Edit Phase 7:');
  has(deploy, /\*\*The clear choice, recorded for each upload\.\*\* A clear of a page that binds a built-in operation is the maker's choice from Edit Phase 3 \(or from the edit planner's `clear_choice_required`\), made before any binding was reconciled and before the plan was approved\./);
  has(deploy, /Right before each upload it authorizes, record the confirmed clear again as its own line in `workflow-log\.md`/);
  has(deploy, /Clear choice: Clear every action binding of page <page-id>, removing <names>/);
  has(deploy, /Only that line, for this page and every built-in operation it holds, permits `\[\]`, and it covers that one upload: write it again before a retry/);
  has(deploy, /`Clear choice: Keep <names>`, a yes to adding or keeping an operation, an answer with conditions, or a choice written after the upload is no permission/);
  has(deploy, /\*\*Unattended:\*\* do not clear/);
  has(section(read('agents', 'genpage-customapi-builder.md'), '## Step 4'), /only the maker's clear choice, asked before any binding is reconciled \(edit-flow\.md, Edit Phase 3\) and recorded again right before each upload it authorizes, permits `\[\]`/);
  const reference = squash(read('references', 'dataverse-operations.md'));
  has(reference, /\| clear all \| after the maker's clear choice, asked before any binding is reconciled or the plan is approved, which names the built-ins it removes \| `\[\]` \| delete every call \|/);
  has(reference, /recorded then and again right before each upload it covers as `Clear choice: Clear every action binding of page <page-id>, removing <names>`/);
  has(section(read('skills', 'genpage', 'SKILL.md'), '### Phase 6: Deploy', '**Deploy through `scripts/genpage-upload.js`.**'), /only after the maker's clear choice naming each one, asked before any binding is reconciled or the plan is approved \(edit-flow\.md, Edit Phase 3\) and recorded again right before the upload/);
});

// The clear choice decides what the edit removes, so it is asked before anything is removed: before Edit Phase 3 reconciles a binding, before the
// edit planner plans and the maker approves the plan, and so before Edit Phase 5 edits the source. Asked after that, a `Keep` would come too late —
// the calls and their buttons would already be gone, and nothing puts them back. A clear the planner's clarification turns up is asked the same
// way, before the plan is approved; the deploy step only records the confirmed answer again for each upload.
test('the clear choice is asked first — before any binding is reconciled and before the plan is approved — and on Keep the built-in calls and bindings stay', () => {
  const edit = read('skills', 'genpage', 'edit-flow.md');
  const phase3 = edit.slice(edit.indexOf('## Edit Phase 3:'), edit.indexOf('## Edit Phase 4:'));
  const asked = phase3.indexOf('**The clear choice — asked first.**');
  assert.ok(asked !== -1, 'Edit Phase 3 asks the clear choice');
  for (const recipe of ['> **Connectors are owned by', '> **Custom APIs are owned by', '> **Built-in Dataverse operations']) {
    assert.ok(phase3.indexOf(recipe) !== -1 && asked < phase3.indexOf(recipe), `the clear choice is asked before ${recipe}`);
  }
  const intent = squash(phase3);
  has(intent, /\*\*The clear choice — asked first\.\*\* A request to clear every action binding of a page whose `actionBindings` holds a built-in operation row \(`WhoAmI`, `RetrieveVersion`\) deletes those operations too, so the maker chooses before anything else in this edit: before any binding is reconciled \(below\), before the edit planner runs and the plan is approved \(Edit Phase 4\), and before Edit Phase 5 touches the source/);
  has(intent, /Ask with `AskUserQuestion` with exactly two options — `Clear every action binding, removing <names>` and `Keep <names>`/);
  has(intent, /Clear choice: Clear every action binding of page <page-id>, removing <names>/);
  has(intent, /\*\*Keep:\*\* there is no clear\. Neither the built-in calls — their handlers, buttons and UI — nor their bindings are removed/);
  has(intent, /\*\*Unattended:\*\* do not clear and ask nothing; stop before any binding or source changes/);
  has(intent, /Silence is never a clear\./);
  has(intent, /\| clear all \| after the maker's clear choice, asked first \(above\), which names the built-ins removed \| `\[\]` \| delete every call \|/);
  // Planning gets the answer; a clear found in the planner's clarification is asked before the plan is approved.
  const planning = section(edit, '## Edit Phase 4:', '## Edit Phase 5:');
  has(planning, /The clear choice from Edit Phase 3, when one was asked: its `Clear choice:` line, verbatim/);
  has(planning, /\*\*If the planner returns `\{ "action": "clear_choice_required", … \}`\*\*/);
  has(planning, /The plan is approved only after the maker chose, so the source is never edited before that choice\./);
  has(planning, /- \*\*`\{ "action": "clear_choice_required", … \}`\*\* — handled above\./);
  has(planning, /every prior discovery \(connector, Custom API and built-in operation contracts, and their upload file status; entities\), the clear choice, and every answer already gathered/);
  // Deploy records the answer again; it never asks the question.
  const deploy = section(edit, '## Edit Phase 6:', '## Edit Phase 7:');
  assert.ok(!/exactly two options/.test(deploy), 'Edit Phase 6 does not ask the clear question');
  has(deploy, /Never ask it for the first time here — the source was edited in Edit Phase 5/);
  // The edit planner plans a clear only on a forwarded choice, keeps everything on Keep, and asks for the choice rather than planning without it.
  const editPlanner = squash(read('agents', 'genpage-edit-planner.md'));
  has(editPlanner, /\*\*clear all\*\* — only when your prompt carries the maker's clear choice `Clear choice: Clear every action binding of page <page-id>, removing <names>`/);
  has(editPlanner, /On `Clear choice: Keep <names>` there is no clear: keep the built-in calls — their handlers, buttons and UI — and their bindings/);
  has(editPlanner, /"action": "clear_choice_required"/);
  // No document still asks the choice in the deploy phase.
  for (const [name, text] of [
    ['edit-flow.md', squash(edit)],
    ['genpage-edit-planner.md', editPlanner],
    ['genpage-customapi-builder.md', squash(read('agents', 'genpage-customapi-builder.md'))],
    ['SKILL.md', squash(read('skills', 'genpage', 'SKILL.md'))],
    ['dataverse-operations.md', squash(read('references', 'dataverse-operations.md'))],
  ]) {
    assert.ok(!/clear choice[^.]*\(?(?:edit-flow\.md,? )?Edit Phase 6\b/.test(text), `${name}: the clear choice is not placed in Edit Phase 6`);
  }
});

// A create that asks for WhoAmI or RetrieveVersion sends the planner's signal to the builder once. When the builder adds none — its gate is off,
// or the maker declined the offer or selected neither — it writes no `dataverse-operations.md`, and the maker's request still reads as the same
// signal. So the builder reports that outcome in so many words, the orchestrator forwards it to every later planner round, and the planner
// completes the plan without the call instead of asking for the offer again: the edit flow's `none — not added this run`, now in the create flow.
test('a create whose built-in offer adds nothing — the gate off, or the offer declined — forwards `none — not added this run`, and the planner completes without the call instead of signalling again', () => {
  const builder = section(read('agents', 'genpage-customapi-builder.md'), '## Step 5');
  has(builder, /When this run adds none — the `dataverse-operations` gate is off, or the maker declined the offer or selected neither — say `dataverse-operations\.md: none — not added this run` with the reason \(`gate off` or `none selected`\)/);
  has(builder, /the orchestrator forwards that outcome, never a contract, so the planner completes its plan without the call instead of asking for this offer again/);
  has(builder, /whether `dataverse-operations\.md` was written this run \(or `none — not added this run` and why\)/);
  assert.ok(!/so the orchestrator forwards nothing/.test(builder), 'the builder no longer tells the orchestrator to forward nothing');
  const skill = read('skills', 'genpage', 'SKILL.md');
  const offer = section(skill, '#### 1c.', '#### Invocation prompt');
  has(offer, /When it reports `dataverse-operations\.md: none — not added this run` — its `dataverse-operations` gate is off, or the maker declined the offer or selected neither — there is no built-in contract/);
  has(offer, /forward the outcome `none — not added this run` \(never a contract\) to the planner in this and every later round/);
  has(offer, /so the builder is not dispatched a second time for the same request/);
  const prompt = section(skill, '#### Invocation prompt', '### Phase 2:');
  has(prompt, /the outcome `none — not added this run` when this run's builder was dispatched for one and added none \(1c\)/);
  has(prompt, /\[Only when this run's builder added none:\] Built-in Dataverse operations: `none — not added this run`\./);
  has(prompt, /plan the page without that call, write no `## Dataverse Operations` section, and do not return `dataverse_operation_discovery_required` again/);
  has(squash(read('agents', 'genpage-planner.md')), /When your prompt says `none — not added this run`, the builder was already dispatched for the request and added none — its `dataverse-operations` gate is off, or the maker declined the offer or selected neither\. Plan the page without that call, write no `## Dataverse Operations` section, and do not signal again/);
  has(squash(read('references', 'dataverse-operations.md')), /it reports `dataverse-operations\.md: none — not added this run`\. The orchestrator forwards that outcome, never a contract, to the create or edit planner, which completes its plan without the call and does not ask for the offer again/);
  // The edit flow's own rule stays as it was.
  has(squash(read('agents', 'genpage-edit-planner.md')), /When your prompt says `none — not added this run`, the builder added none: plan the edit without that call and do not signal again/);
  has(section(read('skills', 'genpage', 'edit-flow.md'), '## Edit Phase 4:', '## Edit Phase 5:'), /re-invoke the planner with the built-in operation intent `none — not added this run` and no contract/);
});

// While `custom-api` is OFF the builder removes no Custom API row (it keeps them, as it keeps every Custom API binding then). Every recipe that
// sends a removal through it must say what it will get back — the rows kept, the removal reported as not performed, nothing to upload when the
// array is unchanged — and a removal is never turned into a clear to get around the flag. With the flag ON the rows go.
test('with custom-api OFF a Custom API removal removes nothing — the builder keeps the rows and reports it, and every recipe says so; with it ON the rows go', () => {
  const builder = read('agents', 'genpage-customapi-builder.md');
  const off = section(builder, '**If `custom-api` prints `disabled`', 'Only when it prints `enabled`');
  has(off, /A Custom API the intent asks to remove stays too — its table row and its `actions\.json` row — because the removal waits until the flag is on/);
  has(off, /write `Custom API removal not performed \(custom-api disabled\): <names>` \(comma-separated\) into `workflow-log\.md` and return it/);
  has(off, /never write `No custom API bindings\.` or `\[\]` in their place/);
  const reconcile = section(builder, '## Step 4', '## Step 5');
  has(reconcile, /\*\*Remove:\*\* drop the named binding\(s\) — a Custom API row only while `custom-api` is enabled; with it disabled the row stays and the removal is reported as not performed \(Step 1\)/);
  has(reconcile, /With it disabled, keep every row — the Custom API table and rows too — and report the removal as not performed \(Step 1\); never turn it into a clear/);
  has(section(builder, '## Step 5'), /the Custom API removals not performed because `custom-api` is disabled \(or "none"\)/);
  const edit = read('skills', 'genpage', 'edit-flow.md');
  const planning = section(edit, '## Edit Phase 3:', '## Edit Phase 4:');
  has(planning, /With `custom-api` OFF the builder removes no Custom API row: it keeps them — table and rows — and reports `Custom API removal not performed \(custom-api disabled\): <names>`\. Relay that to the maker, keep those calls in the page/);
  has(planning, /With `custom-api` OFF it keeps every row and reports the removal as not performed: relay that, and keep the Custom API table, rows and calls — never `No custom API bindings\.` or `\[\]` in their place, and never a clear to get around the flag/);
  has(planning, /A clear is the maker's own request for an empty array, so no flag decides it/);
  const deploy = section(edit, '## Edit Phase 6:', '## Edit Phase 7:');
  has(deploy, /Include it only when that array differs from the page's current `actionBindings`: with `custom-api` OFF the builder removes no Custom API row, and an array it left unchanged is not uploaded — omit `--actions`/);
  has(deploy, /with it OFF the builder kept every row, so omit `--actions` and relay the removal it did not perform/);
  has(squash(read('references', 'dataverse-operations.md')), /With `custom-api` OFF no Custom API row is removed either: the builder keeps them, reports `Custom API removal not performed \(custom-api disabled\): <names>`, and the page's array stays as it is \(no `--actions`\)/);
  has(squash(read('agents', 'genpage-edit-planner.md')), /With `custom-api` OFF the builder removes no Custom API row and reports the removal as not performed: keep those calls — they are still bound — and say in the plan that the removal waits for the flag/);
  has(section(read('skills', 'genpage', 'SKILL.md'), '### Phase 6: Deploy', '**Deploy through `scripts/genpage-upload.js`.**'), /With `custom-api` OFF a Custom API removal removes nothing: the builder keeps the rows and says so, `--actions` is omitted while the array is unchanged, and a removal is never turned into a clear to get around the flag/);
  // Planning describes the builder's OFF output as it is: no Custom API row, and the built-in rows a maker selected.
  has(section(read('skills', 'genpage', 'SKILL.md'), '#### 1b.', '#### 1c.'), /writes `No custom API bindings\.` and no Custom API row when the gate is off or the page needs no Custom API \(`actions\.json` is then `\[\]`, unless built-in operation rows were selected — 1c\)/);
});
