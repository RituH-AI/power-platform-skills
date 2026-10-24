'use strict';
// Lookup identities in a generated page (lib/polymorphic-lookup-contract.js) and the typed-path context of the column check
// (lib/column-contract.js), graded against a scenario's lookup metadata. The page below is assembled from the canonical normalizer
// references/rules.md publishes and the CORRECT forms of its five pitfalls; each WRONG form is a one-place change of it. The rows,
// tables and paths are synthetic, shaped like get-lookup-metadata.js's answer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lookupContractProblems, normalizerProblems } = require('../lib/polymorphic-lookup-contract.js');
const { columnProblems } = require('../lib/column-contract.js');

const RULES = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'plugins', 'model-apps', 'references', 'rules.md'), 'utf8').replace(/\r\n/g, '\n');
const HEADING = '### Lookup references (Customer, Owner, Regarding and every other lookup)';
const SECTION = RULES.slice(RULES.indexOf(`\n${HEADING}\n`));
const NORMALIZER = [...SECTION.matchAll(/```typescript\n([\s\S]*?)\n```/g)].map((match) => match[1]).find((block) => block.includes('function normalizeLookupReference('));

const LOOKUPS = [{
  table: 'opportunity', column: 'customerid', readProperty: '_customerid_value', targets: ['account', 'contact'],
  paths: [
    { target: 'account', navigationProperty: 'customerid_account', referencedKey: 'accountid' },
    { target: 'contact', navigationProperty: 'customerid_contact', referencedKey: 'contactid' },
  ],
}];
const SCENARIO = { lookups: LOOKUPS, targetColumns: { account: ['name'] } };

const BODY = `
type Row = Record<string, unknown>;
type Picked = { table: 'account' | 'contact'; id: string };

function PageBody(props: GeneratedComponentProps) {
  const { dataApi } = props;

  async function loadAccountOpportunities(row: Row) {
    const normalized = normalizeLookupReference(row, '_customerid_value', ['account', 'contact']);
    if (normalized.state !== 'resolved') return;
    const reference = normalized.reference;
    if (reference.table !== 'account') return;
    const filter = \`customerid_account/accountid eq \${reference.id}\`;
    return dataApi.queryTable('opportunity', { select: ['name', '_customerid_value'], filter });
  }

  async function loadAll() {
    return dataApi.queryTable('opportunity', { select: ['name', '_customerid_value'], filter: '_customerid_value ne null' });
  }

  async function searchAccounts(searchText: string) {
    const escaped = searchText.replace(/'/g, "''");
    const filter = \`customerid_account/accountid ne null and contains(customerid_account/name,'\${escaped}')\`;
    return dataApi.queryTable('opportunity', { select: ['name'], filter });
  }

  async function openCustomer(row: Row) {
    const normalized = normalizeLookupReference(row, '_customerid_value', ['account', 'contact']);
    if (normalized.state !== 'resolved') return;
    const reference = normalized.reference;
    await Xrm.Navigation.navigateTo({ pageType: 'entityrecord', entityName: reference.table, entityId: reference.id });
  }

  async function readCustomer(row: Row) {
    const normalized = normalizeLookupReference(row, '_customerid_value', ['account', 'contact']);
    if (normalized.state !== 'resolved') return;
    const reference = normalized.reference;
    if (reference.table !== 'account') return;
    return dataApi.retrieveRow('account', { id: reference.id, select: ['name'] });
  }

  async function changeCustomer(opportunityId: string, selected: Picked) {
    const link: \`/account(\${string})\` | \`/contact(\${string})\` = selected.table === 'account'
      ? \`/account(\${selected.id})\`
      : \`/contact(\${selected.id})\`;
    await dataApi.updateRow('opportunity', opportunityId, { _customerid_value: link });
  }

  async function clearCustomer(opportunityId: string) {
    await dataApi.updateRow('opportunity', opportunityId, { _customerid_value: null });
  }

  const label = (row: Row) => String(row['_customerid_value@OData.Community.Display.V1.FormattedValue'] ?? '');
  return <div>{label({})}</div>;
}
`;
const PAGE = `import * as React from 'react';\n\n${NORMALIZER}\n${BODY}`;

function swap(source, from, to) {
  assert.ok(source.includes(from), `the page holds: ${from}`);
  return source.split(from).join(to);
}

test('the canonical normalizer and the CORRECT form of every pitfall pass', () => {
  assert.ok(NORMALIZER, 'rules.md publishes the normalizer');
  assert.deepEqual(normalizerProblems(PAGE), []);
  assert.deepEqual(lookupContractProblems(PAGE, SCENARIO), []);
});

test('an altered, missing or duplicated normalizer is not the canonical one', () => {
  for (const [label, source] of [
    ['the first target as a fallback', swap(PAGE, '(allowedTargets.length === 1 ? allowedTargets[0] : undefined)', 'allowedTargets[0]')],
    ['no conflict check', swap(PAGE, "  if (annotation !== undefined && prefix !== undefined && annotation !== prefix) return { state: 'invalid' };\n", '')],
    ['a looser GUID pattern', swap(PAGE, 'const LOOKUP_GUID = /^[0-9a-fA-F]{8}', 'const LOOKUP_GUID = /[0-9a-fA-F]{8}')],
    ['no normalizer', swap(PAGE, NORMALIZER, '')],
    ['a second one', `${PAGE}\nfunction normalizeLookupReference(row: unknown) { return { state: 'invalid' }; }\n`],
  ]) {
    assert.ok(normalizerProblems(source).length > 0, label);
    assert.ok(lookupContractProblems(source, SCENARIO).length > 0, label);
  }
  // Comments and indentation are not substantive.
  const reindented = swap(PAGE, "  const record = row as Record<string, unknown>;", "    // the row is an object here\n    const record = row as Record<string, unknown>;");
  assert.deepEqual(normalizerProblems(reindented), []);
});

test('every WRONG form of the pitfalls fails with a reason that names it', () => {
  const read = "    const normalized = normalizeLookupReference(row, '_customerid_value', ['account', 'contact']);\n    if (normalized.state !== 'resolved') return;\n    const reference = normalized.reference;\n    await Xrm";
  for (const [label, source, reason] of [
    ['A: a raw element read', swap(PAGE, "String(row['_customerid_value@OData.Community.Display.V1.FormattedValue'] ?? '')", "String(row['_customerid_value'] ?? '')"), /reads the raw _customerid_value/],
    ['A: a raw member read', swap(PAGE, "String(row['_customerid_value@OData.Community.Display.V1.FormattedValue'] ?? '')", 'String(row._customerid_value)'), /reads the raw _customerid_value/],
    ['A: a raw id filter', swap(PAGE, "filter: '_customerid_value ne null'", 'filter: `_customerid_value eq ${String(row)}`'), /not the bare id of a resolved _customerid_value reference/],
    ['A: a raw retrieveRow id', swap(PAGE, '{ id: reference.id, select:', "{ id: String(row._customerid_value), select:"), /raw lookup value as the id/],
    ['A: retrieve a fixed table without checking the reference', swap(PAGE, "    if (reference.table !== 'account') return;\n    return dataApi.retrieveRow", '    return dataApi.retrieveRow'), /not the reference's own table/],
    ['B: a typed path compared before the table is checked', swap(PAGE, "    if (reference.table !== 'account') return;\n    const filter", '    const filter'), /before the page checks that reference\.table is account/],
    ['B: a typed path compared with a raw value', swap(PAGE, 'customerid_account/accountid eq ${reference.id}', 'customerid_account/accountid eq ${String(row)}'), /not a resolved reference's bare id/],
    ['C: an invented Owner path', swap(PAGE, 'customerid_account/accountid ne null and', 'ownerid_team/teamid ne null and'), /ownerid_team, which is not a verified concrete lookup path/],
    ['C: an unverified target column', swap(PAGE, 'contains(customerid_account/name,', 'contains(customerid_account/fullname,'), /customerid_account\/fullname, which is not a verified column of account/],
    ['D: a fixed navigation target', swap(PAGE, 'entityName: reference.table, entityId: reference.id', "entityName: 'account', entityId: reference.id"), /not the reference's own table/],
    ['D: a raw navigation id', swap(PAGE, 'entityName: reference.table, entityId: reference.id', "entityName: 'account', entityId: row['_customerid_value'] as string"), /raw/],
    ['E: a fixed write table', swap(PAGE, '{ _customerid_value: link }', '{ _customerid_value: `/account(${selected.id})` }'), /written to a fixed table/],
    ['E: a formatter branch that formats another table', swap(PAGE, "? `/account(${selected.id})`", '? `/contact(${selected.id})`'), /do not each format the table they test/],
    ['E: an empty-string clear', swap(PAGE, '{ _customerid_value: null }', "{ _customerid_value: '' }"), /cleared with an empty string/],
    ['E: @odata.bind', swap(PAGE, '{ _customerid_value: null }', "{ 'customerid_account@odata.bind': '/accounts(x)' }"), /@odata\.bind/],
    ['a partial target set', swap(PAGE, "normalizeLookupReference(row, '_customerid_value', ['account', 'contact']);\n    if (normalized.state !== 'resolved') return;\n    const reference = normalized.reference;\n    await", "normalizeLookupReference(row, '_customerid_value', ['account']);\n    if (normalized.state !== 'resolved') return;\n    const reference = normalized.reference;\n    await"), /not its complete metadata target set/],
    ['a property that is not a recorded lookup', swap(PAGE, read, "    const normalized = normalizeLookupReference(row, '_ownerid_value', ['systemuser', 'team']);\n    if (normalized.state !== 'resolved') return;\n    const reference = normalized.reference;\n    await Xrm"), /not a recorded lookup/],
    ['no resolved guard', swap(PAGE, read, "    const normalized = normalizeLookupReference(row, '_customerid_value', ['account', 'contact']);\n    const reference = normalized.reference;\n    await Xrm"), /used before the page checks/],
    ['the target annotation read directly', swap(PAGE, "String(row['_customerid_value@OData.Community.Display.V1.FormattedValue'] ?? '')", "String(row['_customerid_value@Microsoft.Dynamics.CRM.lookuplogicalname'] ?? '')"), /annotation itself/],
    ['an unverifiable use', swap(PAGE, "const label = (row: Row)", "const key = '_customerid_value';\n  const label = (row: Row)"), /cannot verify/],
  ]) {
    const found = lookupContractProblems(source, SCENARIO);
    assert.ok(found.some((problem) => reason.test(problem)), `${label}: ${JSON.stringify(found)}`);
  }
});

test('without scenario lookup metadata nothing is graded as passing', () => {
  assert.deepEqual(lookupContractProblems(PAGE, { lookups: [] }), ['the scenario names no lookup metadata to grade against']);
});

// --- the column check's typed-path context ---------------------------------------------------------------------------------------

const RUNTIME_TYPES = `
export interface TableRegistrations extends BaseTableRegistrations {
    "opportunity": opportunity,
    "account": account,
}
export type opportunity = TableRow<{
    readonly opportunityid: string,
    name: string,
    _customerid_value: \`/account(\${string})\` | \`/contact(\${string})\`,
}>
export type account = TableRow<{
    readonly accountid: string,
    name: string,
}>
`;
const PATH_CONTEXT = { lookupPaths: LOOKUPS[0].paths.map((entry) => ({ table: 'opportunity', ...entry })), targetColumns: { account: ['name'] } };
const filtered = (filter) => [{ name: 'page.tsx', content: `export default function P({ dataApi }) { dataApi.queryTable('opportunity', { select: ['name'], filter: ${JSON.stringify(filter)} }); return null; }` }];

test('with lookup context a typed path is checked whole; without it the column check reads the text exactly as before', () => {
  assert.deepEqual(columnProblems(filtered('customerid_account/accountid ne null'), RUNTIME_TYPES, PATH_CONTEXT), []);
  assert.deepEqual(columnProblems(filtered("contains(customerid_account/name,'x')"), RUNTIME_TYPES, PATH_CONTEXT), []);
  assert.deepEqual(columnProblems(filtered('customerid_contact/contactid ne null'), RUNTIME_TYPES, PATH_CONTEXT), [], 'a target RuntimeTypes does not register is held to its key and verified columns');
  assert.match(columnProblems(filtered('ownerid_team/teamid ne null'), RUNTIME_TYPES, PATH_CONTEXT)[0], /ownerid_team\/teamid, which is not a verified navigation path of opportunity/);
  assert.match(columnProblems(filtered('customerid_account/revenue gt 0'), RUNTIME_TYPES, PATH_CONTEXT)[0], /customerid_account\/revenue, which is not a verified column of account/);
  assert.match(columnProblems(filtered('customerid_contact/fullname ne null'), RUNTIME_TYPES, PATH_CONTEXT)[0], /not a verified column of contact/);
  // Legacy: no context, no exemption for a slash — its parts are read as columns of the queried table, as before.
  assert.deepEqual(columnProblems(filtered('customerid_account/accountid ne null'), RUNTIME_TYPES), [
    "page.tsx: queryTable('opportunity') filter names accountid, which RuntimeTypes.ts does not declare on opportunity",
  ]);
  assert.deepEqual(columnProblems(filtered("name eq 'x'"), RUNTIME_TYPES), [], 'neighbour: a plain column');
  assert.deepEqual(columnProblems(filtered("name eq 'x'"), RUNTIME_TYPES, PATH_CONTEXT), [], 'neighbour: a plain column with context');
});
