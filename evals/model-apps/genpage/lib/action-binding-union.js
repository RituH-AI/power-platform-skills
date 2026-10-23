'use strict';
// The union of a page's two kinds of `actionBindings` entry, as the evaluators of a Custom API lifecycle compare an `actions.json`, a plan and a page's config.
//
// A page holds ONE `actionBindings` array, written whole by `genpage-upload.js --actions` (a full replace: an entry the file leaves out is deleted), and genpage-customapi-builder is
// its one writer. It holds two partitions:
//   - Custom API rows, from the plan's `## Custom API Bindings` and `list-custom-apis.js` discovery (custom-api-contract.js);
//   - the reviewed built-in Dataverse operations — exactly WhoAmI and RetrieveVersion (plugins/model-apps/scripts/lib/dataverse-operations.js) — from the plan's OPTIONAL
//     `## Dataverse Operations` section and `list-dataverse-operations.js` (this file).
// A desired array is the Custom API rows first, in their own order, then the built-in projections in catalogue order. Comparing a mixed array with the Custom API partition alone fails
// it, and passing it by dropping either partition would hide a binding the upload is about to delete — so what is compared is always the whole union.
//
// The section, when present, is the exact sentinel `No Dataverse operations.` or the table below — anything else halts:
//   ## Dataverse Operations
//   Verification: environment not-checked, runtime not-checked, privileges not-checked.
//   | Name | Kind | Bound Entity | Display Name | Parameters | Response fields | Invoke |
//   |------|------|--------------|--------------|------------|-----------------|--------|
//   | WhoAmI | Function | (Global) | Current Dataverse identity | (none) | BusinessUnitId, UserId, OrganizationId | button |
// Every cell is the catalogue's own, so a row is checked against the catalogue and projected by it (toActionBinding), never re-derived from the text.
const { isDeepStrictEqual } = require('node:util');
const {
  AUTHORING_CODES, getDataverseOperationCatalogue, getReviewedDataverseOperation, toActionBinding,
} = require('../../../../plugins/model-apps/scripts/lib/dataverse-operations.js');
const { planSection, parseMarkdownRows } = require('./plan-evidence.js');
const { isGeneration, isUpload, resultObject } = require('./workflow-evidence.js');

const SECTION = 'Dataverse Operations';
const SENTINEL = 'No Dataverse operations.';
const VERIFICATION_LINE = 'Verification: environment not-checked, runtime not-checked, privileges not-checked.';
const COLUMNS = ['Name', 'Kind', 'Bound Entity', 'Display Name', 'Parameters', 'Response fields', 'Invoke'];
const CATALOGUE_ORDER = getDataverseOperationCatalogue().operations.map((operation) => operation.name);

// The output names each built-in operation's response declares — what a page may read from `res.outputs` of that call.
const BUILT_IN_OUTPUTS = Object.freeze(Object.fromEntries(getDataverseOperationCatalogue().operations.map((operation) => [operation.name, Object.keys(operation.response.properties)])));

// An entry that names a built-in operation, by its EXACT name (as the catalogue matches it: `whoami` is a Custom API name).
const isBuiltInBinding = (entry) => Boolean(entry && typeof entry === 'object' && getReviewedDataverseOperation(entry.name));

const isBuiltInGate = (command) => /\bfeature-flags\.js\b[^\n]*\bdataverse-operations\b/.test(command);
const isBuiltInListing = (command) => /\blist-dataverse-operations\.js\b/.test(command);
const gateValue = (call) => {
  const raw = typeof call.result === 'string' ? call.result.trim() : '';
  return raw === 'enabled' || raw === 'disabled' ? raw : null;
};

// { customApis, builtIns } of a list, each in the list's own order.
function partitionBindings(list) {
  const customApis = [];
  const builtIns = [];
  for (const entry of list || []) (isBuiltInBinding(entry) ? builtIns : customApis).push(entry);
  return { customApis, builtIns };
}

// The built-in rows a plan authors this run: null when the plan has no `## Dataverse Operations` section (nothing new is authored), [] for the exact sentinel, otherwise the wire rows of
// its table, in catalogue order. A section that is anything else throws: an evaluator must not read an unreadable selection as "none".
function plannedBuiltIns(plan) {
  const body = planSection(plan, SECTION);
  if (body === null) return null;
  if (body === SENTINEL) return [];
  if (body.split(/\r?\n/)[0].trim() !== VERIFICATION_LINE) throw new Error('Dataverse Operations must open with the not-checked verification line or be the exact sentinel');
  const rows = parseMarkdownRows(body, COLUMNS);
  if (!rows.length) throw new Error('Dataverse Operations must be the built-in operation table or the exact sentinel');
  const seen = new Set();
  const out = rows.map((row) => {
    const operation = getReviewedDataverseOperation(row.name);
    if (!operation) throw new Error(AUTHORING_CODES.not_in_catalogue);
    if (seen.has(operation.name)) throw new Error(AUTHORING_CODES.duplicate_operation);
    seen.add(operation.name);
    const expected = {
      kind: 'Function', 'bound entity': '(Global)', 'display name': operation.displayName, parameters: '(none)',
      'response fields': Object.keys(operation.response.properties).join(', '), invoke: 'button',
    };
    for (const [cell, value] of Object.entries(expected)) {
      if (row[cell] !== value) throw new Error(`${operation.name}: the ${cell} cell is not the catalogue's (${AUTHORING_CODES.invalid_operation_contract})`);
    }
    return toActionBinding(operation);
  });
  const order = out.map((entry) => CATALOGUE_ORDER.indexOf(entry.name));
  if (order.some((at, i) => i > 0 && at < order[i - 1])) throw new Error('Dataverse Operations rows must be in catalogue order (WhoAmI, then RetrieveVersion)');
  return out;
}

// The one desired array: the Custom API rows, then the built-in rows. A name in both, or twice, is no union at all.
function unionBindings(customApis, builtIns) {
  const names = new Set();
  for (const entry of [...customApis, ...builtIns]) {
    if (names.has(entry.name)) throw new Error(AUTHORING_CODES.duplicate_operation);
    names.add(entry.name);
  }
  return [...customApis, ...builtIns];
}

// What `list-dataverse-operations.js` offered, by name: the wire projection of each descriptor it listed. A listing that failed, or listed anything but the reviewed pair exactly, offers
// nothing, and is a problem: an evaluator never projects a row from an altered descriptor (toActionBinding refuses one).
function listedBuiltIns(calls) {
  const offered = new Map();
  const problems = [];
  for (const call of calls.filter((entry) => isBuiltInListing(entry.command))) {
    const result = resultObject(call);
    if (result?.ok !== true || !Array.isArray(result.operations)) {
      problems.push('built-in operation listing failed or returned an unreadable catalogue');
      continue;
    }
    // Exactly the documented envelope: a field such as `eligible` would claim a check the command does not make.
    const { ok, catalogueVersion, verification, operations, ...rest } = result;
    if (ok !== true || catalogueVersion !== 1 || Object.keys(rest).length || verification?.mode !== 'catalogue-only'
      || ['environment', 'runtime', 'privileges'].some((key) => verification[key] !== 'not-checked')) {
      problems.push('built-in operation listing claims more than a catalogue-only offer');
      continue;
    }
    if (!isDeepStrictEqual(operations.map((operation) => operation && operation.name), CATALOGUE_ORDER)) {
      problems.push('built-in operation listing is not exactly the reviewed pair');
      continue;
    }
    for (const operation of operations) {
      // toActionBinding accepts a listed descriptor only when it is structurally the catalogue's own.
      try {
        offered.set(operation.name, toActionBinding(operation));
      } catch (error) {
        problems.push(`${operation.name}: listed descriptor is not the reviewed contract (${error.code})`);
      }
    }
  }
  return { offered, problems };
}

// The order a NEW actions file keeps: every Custom API row before the first built-in row, and the built-ins in catalogue order.
function unionOrderProblems(list, label) {
  const problems = [];
  const kinds = (list || []).map(isBuiltInBinding);
  const firstBuiltIn = kinds.indexOf(true);
  if (firstBuiltIn !== -1 && kinds.slice(firstBuiltIn).includes(false)) problems.push(`${label}: built-in operation rows must follow every Custom API row`);
  const order = (list || []).filter(isBuiltInBinding).map((entry) => CATALOGUE_ORDER.indexOf(entry.name));
  if (order.some((at, i) => i > 0 && at <= order[i - 1])) problems.push(`${label}: built-in operation rows must be in catalogue order, each once`);
  return problems;
}

// The gate of built-in authoring: `list-dataverse-operations.js` runs only after an ENABLED `dataverse-operations` probe, and a stage that authors a built-in row (`authoring`: the
// upload ids of the stages that add or replace one) generates and uploads only after a re-probe that is enabled and comes after the listing. A stage that only preserves the rows a page
// already holds does not consult this gate (a page keeps its bindings whatever the flag says).
function builtInGateProblems(calls, authoring) {
  const problems = [];
  let latest = null;
  for (const call of calls) {
    if (isBuiltInGate(call.command)) latest = gateValue(call);
    else if (isBuiltInListing(call.command) && latest !== 'enabled') problems.push('built-in operation listing ran before an enabled dataverse-operations gate');
  }
  const lastBefore = (end, predicate) => {
    for (let index = end - 1; index >= 0; index -= 1) if (predicate(calls[index].command)) return index;
    return -1;
  };
  for (const uploadId of authoring) {
    const uploadIndex = calls.findIndex((call) => call.id === uploadId && isUpload(call.command));
    if (uploadIndex === -1) continue;
    const gate = lastBefore(uploadIndex, isBuiltInGate);
    const listing = lastBefore(uploadIndex, isBuiltInListing);
    const generation = lastBefore(uploadIndex, isGeneration);
    if (listing === -1) problems.push(`${uploadId}: built-in operation rows were authored without a listing that offered them`);
    if (gate === -1 || gateValue(calls[gate]) !== 'enabled') problems.push(`${uploadId}: a disabled or unreadable dataverse-operations gate must halt built-in authoring before generation or upload`);
    else if (gate < listing) problems.push(`${uploadId}: built-in authoring must re-probe the dataverse-operations gate after the listing`);
    else if (generation !== -1 && gate > generation) problems.push(`${uploadId}: the dataverse-operations re-probe must come before generation`);
  }
  return problems;
}

module.exports = {
  SECTION, SENTINEL, VERIFICATION_LINE, BUILT_IN_OUTPUTS,
  isBuiltInBinding, partitionBindings, plannedBuiltIns, unionBindings, listedBuiltIns, unionOrderProblems, builtInGateProblems,
};
