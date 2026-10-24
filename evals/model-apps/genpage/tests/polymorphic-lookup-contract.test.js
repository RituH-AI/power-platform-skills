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

test('a table check proves the target only when it dominates the use with the right polarity', () => {
  const guard = "    if (reference.table !== 'account') return;\n    const filter";
  for (const [label, from, to] of [
    ['the inverted guard returns for an account', guard, "    if (reference.table === 'account') return;\n    const filter"],
    ['a guard that does not leave', guard, "    if (reference.table !== 'account') console.warn('not an account');\n    const filter"],
    ['a guard in a branch the use is not in', guard, "    if (row) { if (reference.table !== 'account') return; }\n    const filter"],
    ['a guard in a function only defined', guard, "    const check = () => { if (reference.table !== 'account') return; };\n    const filter"],
    ['a guard behind else', guard, "    if (!row) return;\n    else if (reference.table !== 'account') return;\n    const filter"],
    ['a comparison only mentioned', guard, "    const isAccount = reference.table === 'account';\n    const filter"],
    ['a comparison in a comment', guard, "    // if (reference.table !== 'account') return;\n    const filter"],
  ]) {
    const found = lookupContractProblems(swap(PAGE, from, to), SCENARIO);
    assert.ok(found.some((problem) => /before the page checks that reference\.table is account/.test(problem)), `${label}: ${JSON.stringify(found)}`);
  }
  // The use inside the matching positive branch is proven; a braced early exit is too.
  const positive = swap(PAGE, "    if (reference.table !== 'account') return;\n    const filter = `customerid_account/accountid eq ${reference.id}`;\n    return dataApi.queryTable('opportunity', { select: ['name', '_customerid_value'], filter });",
    "    if (reference.table === 'account') {\n      const filter = `customerid_account/accountid eq ${reference.id}`;\n      return dataApi.queryTable('opportunity', { select: ['name', '_customerid_value'], filter });\n    }");
  assert.deepEqual(lookupContractProblems(positive, SCENARIO), []);
  assert.deepEqual(lookupContractProblems(swap(PAGE, guard, "    if (reference.table !== 'account') { return; }\n    const filter"), SCENARIO), []);
  // The same rule for a fixed retrieveRow table.
  const retrieve = "    if (reference.table !== 'account') return;\n    return dataApi.retrieveRow";
  assert.ok(lookupContractProblems(swap(PAGE, retrieve, "    if (reference.table === 'account') return;\n    return dataApi.retrieveRow"), SCENARIO)
    .some((problem) => /not the reference's own table/.test(problem)), 'an inverted guard before a fixed retrieveRow table');
});

test('the resolved pair stays the one the normalizer returned: a written, computed or handed-on pair is refused', () => {
  const open = "    await Xrm.Navigation.navigateTo({ pageType: 'entityrecord', entityName: reference.table, entityId: reference.id });";
  for (const [label, line] of [
    ['its table overwritten', "    reference.table = 'account';"],
    ['its id overwritten', "    reference.id = '00000000-0000-0000-0000-000000000000';"],
    ['its table written computed', "    reference['table'] = 'account';"],
    ['its table deleted', '    delete (reference as any).table;'],
    ['filled through Object.assign', "    Object.assign(reference, { table: 'account' });"],
    ['handed on whole', '    rewrite(reference);'],
    ['the normalization\'s reference replaced', "    (normalized as any).reference = { table: 'account', id: reference.id };"],
    ['the normalization\'s state written', "    (normalized as any).state = 'resolved';"],
    ['the normalization handed on', '    rewrite(normalized);'],
  ]) {
    const found = lookupContractProblems(swap(PAGE, open, `${line}\n${open}`), SCENARIO);
    assert.ok(found.some((problem) => /is changed or handed on after the page normalizes it/.test(problem)), `${label}: ${JSON.stringify(found)}`);
  }
  // Reads through members stay accepted.
  assert.deepEqual(lookupContractProblems(swap(PAGE, open, `    const shown = \`\${reference.table}:\${reference.id}\`;\n    void shown;\n${open}`), SCENARIO), []);
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

// ---------- eval 26's synthetic customer values, run through the published normalizer ----------
// The fixture's lookup-rows.json holds synthetic Customer values (account and contact, bare and qualified, null, contradictory and
// foreign evidence, a plural entity set, equal labels, one GUID in two tables), each with the state the normalizer must give it.
// The trusted helper is the rules.md block itself, transpiled with the TypeScript the plugin vendors and called directly — the
// fixture's page module is never executed to find out what it means.
const { loadVendoredTypeScript } = require('../../../../plugins/model-apps/scripts/lib/typescript-compiler.js');
const { evidenceLookups } = require('../lib/polymorphic-lookup-contract.js');
const FIXTURE_26 = path.join(__dirname, '..', 'fixtures', '26-customer-lookup');

function publishedNormalizer() {
  const typescript = loadVendoredTypeScript();
  const { outputText } = typescript.transpileModule(`${NORMALIZER}\nexport { normalizeLookupReference };\n`, {
    fileName: 'normalizer.ts',
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', outputText)(module, module.exports, () => { throw new Error('the helper imports nothing'); });
  return module.exports.normalizeLookupReference;
}

test('eval 26: every synthetic customer value gets the state lookup-rows.json records, and the resolved ones stay apart by table and id', () => {
  const normalize = publishedNormalizer();
  const { lookup, rows } = JSON.parse(fs.readFileSync(path.join(FIXTURE_26, 'lookup-rows.json'), 'utf8'));
  const metadata = evidenceLookups(JSON.parse(fs.readFileSync(path.join(FIXTURE_26, 'lookup-metadata.json'), 'utf8')));
  const recorded = metadata.find((entry) => entry.table === lookup.table && entry.column === lookup.column);
  assert.deepEqual(recorded.targets, lookup.targets, 'the rows are normalized with the complete target set the metadata read');
  const states = new Set();
  for (const entry of rows) {
    assert.deepEqual(normalize(entry.row, lookup.readProperty, lookup.targets), entry.expected, entry.case);
    states.add(entry.expected.state);
  }
  assert.deepEqual([...states].sort(), ['invalid', 'needs-target', 'resolved', 'unset'], 'every state is exercised');
  // Equal labels, and one GUID in two tables, are different customers: the picker keys them by table and id.
  const resolved = rows.map((entry) => normalize(entry.row, lookup.readProperty, lookup.targets)).filter((result) => result.state === 'resolved');
  const keys = new Set(resolved.map(({ reference }) => `${reference.table}:${reference.id}`));
  const label = (entry) => entry.row['_customerid_value@OData.Community.Display.V1.FormattedValue'];
  const contoso = rows.filter((entry) => label(entry) === 'Contoso').map((entry) => normalize(entry.row, lookup.readProperty, lookup.targets));
  assert.deepEqual(contoso.map(({ reference }) => reference.table), ['account', 'contact']);
  assert.equal(contoso[0].reference.id, contoso[1].reference.id, 'one GUID in both tables');
  assert.ok(keys.has(`account:${contoso[0].reference.id}`) && keys.has(`contact:${contoso[1].reference.id}`));
});

test('evidenceLookups reads every lookup of a successful metadata answer with its table, and nothing from a failed one', () => {
  const answer = JSON.parse(fs.readFileSync(path.join(FIXTURE_26, 'lookup-metadata.json'), 'utf8'));
  const lookups = evidenceLookups(answer);
  assert.deepEqual(lookups.map((entry) => `${entry.table}.${entry.column}`), ['opportunity.customerid', 'opportunity.ownerid', 'opportunity.parentaccountid', 'opportunity.parentcontactid']);
  assert.deepEqual(lookups.find((entry) => entry.column === 'ownerid').paths, [], 'a shared path is not a concrete one');
  assert.equal(evidenceLookups({ ok: false, code: 'LOOKUP_TABLE_NOT_FOUND', error: 'x' }), null);
  assert.equal(evidenceLookups(null), null);
});