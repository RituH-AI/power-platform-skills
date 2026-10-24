'use strict';
// What the reference documents teach about data semantics and lookup identities, pinned where a page builder or the planner reads it.
// Nothing executes these documents, so a reworded rule could quietly put back the advice that broke pages: that a lookup's
// `_<field>_value` is a GUID (the current player returns `/<table>(<guid>)` for Customer and Owner lookups), that a Customer
// lookup can be opened as an account, or that a failed lookup write may be retried.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(PLUGIN, ...parts), 'utf8').replace(/\r\n/g, '\n');
const RULES = read('references', 'rules.md');
const LOOKUPS_HEADING = '### Lookup references (Customer, Owner, Regarding and every other lookup)';

function section(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `the document has the section "${heading}"`);
  const next = text.slice(start + heading.length + 2).search(/\n#{2,3} /);
  return next < 0 ? text.slice(start) : text.slice(start, start + heading.length + 2 + next);
}

test('rules.md no longer says a lookup `_<field>_value` read value is the GUID; it teaches the dual shape', () => {
  assert.doesNotMatch(RULES, /`_<field>_value` is the GUID/, 'the measured player returns `/<table>(<guid>)` for Customer and Owner lookups');
  assert.match(RULES, /normalizeLookupReference/, 'the read contract names the canonical normalizer');
  const usage = section(RULES, '## DataAPI Usage Examples');
  assert.match(usage, /bare GUID or `\/<table>\(<guid>\)`/, 'the usage examples state both read shapes');
  assert.match(usage, /FormattedValue/, 'neighbour: the label still comes from the FormattedValue annotation');
});

test('the lookup section sits after DataAPI Rule 13, shows the canonical normalizer once, and states the measured read contract', () => {
  const rule13 = RULES.indexOf('13. **Setting a lookup on create/update');
  const lookups = RULES.indexOf(`\n${LOOKUPS_HEADING}\n`);
  const grid = RULES.indexOf('\n### DataGrid Requirements\n');
  assert.ok(rule13 > 0 && rule13 < lookups && lookups < grid, 'between Rule 13 and the DataGrid requirements');
  const body = section(RULES, LOOKUPS_HEADING);
  assert.equal((body.match(/\bfunction normalizeLookupReference\(/g) || []).length, 1, 'the body is shown once, not reimplemented per pair');
  for (const state of ["'unset'", "'resolved'", "'needs-target'", "'invalid'"]) assert.ok(body.includes(state), state);
  assert.match(body, /@Microsoft\.Dynamics\.CRM\.lookuplogicalname/);
  assert.match(body, /HTTP 400/, 'a qualified filter operand is refused');
  assert.match(body, /Single-target lookups, team-owned rows, Regarding and `loadMoreRows` pages were not part of that verification/, 'the live claim is scoped');
  assert.match(body, /complete\*\* target set/, 'allowedTargets is the complete metadata target set');
  // Rules 12 and 13 point at it, and keep their own advice.
  const rule12 = RULES.slice(RULES.indexOf('12. **Lookup display-name fields'), rule13);
  assert.match(rule12, /Lookup references/);
  assert.match(rule12, /@OData\.Community\.Display\.V1\.FormattedValue/);
  const rule13Text = RULES.slice(rule13, lookups);
  assert.match(rule13Text, /Lookup references/);
  assert.match(rule13Text, /never `@odata\.bind`/);
});

test('the five pitfalls each show WRONG and CORRECT, and the CORRECT code never guesses a target', () => {
  const body = section(RULES, LOOKUPS_HEADING);
  const pairs = ['**A. Read and consume a normalized identity.**', '**B. Select the relationship and roll-up meaning before generating a filter.**',
    '**C. Non-id filters and name searches do not implicitly select a target.**', '**D. Navigate to the resolved target with the bare id.**',
    '**E. Write the selected target; rebuild the qualified form only at the write boundary.**'];
  let at = 0;
  for (const pair of pairs) {
    const start = body.indexOf(pair, at);
    assert.ok(start >= at, `${pair} in order`);
    const next = pairs.indexOf(pair) + 1 < pairs.length ? body.indexOf(pairs[pairs.indexOf(pair) + 1]) : body.length;
    const text = body.slice(start, next);
    assert.match(text, /\/\/ WRONG/, `${pair} WRONG`);
    assert.match(text, /\/\/ CORRECT/, `${pair} CORRECT`);
    at = start + 1;
  }
  const correct = [...body.matchAll(/\/\/ CORRECT[^\n]*\n([\s\S]*?)(?=\n\/\/ |\n```)/g)].map((match) => match[1]).join('\n');
  assert.match(correct, /entityName: reference\.table, entityId: reference\.id/, 'navigation uses the resolved pair');
  assert.match(correct, /customerid_account\/accountid eq \$\{reference\.id\}/, 'a typed path with the bare id');
  assert.match(correct, /selected\.table === 'account'/, 'a write chooses the table from the selection');
  assert.doesNotMatch(correct, /targets\[0\]|allowedTargets\[0\]\s*\]/, 'never the first target');
  assert.doesNotMatch(body, /ownerid_(?:team|systemuser)/, 'no manufactured Owner path');
  assert.doesNotMatch(correct, /@odata\.bind/);
  assert.match(body, /`_customerid_value: null`/, 'a link is cleared with null');
});

test('lookup failures go through the five-argument reporter: reads as read, writes as write with no retry', () => {
  const body = section(RULES, LOOKUPS_HEADING);
  const calls = [...body.matchAll(/reportPageError\(([^)]*)\)/g)].map((match) => match[1]);
  assert.ok(calls.length >= 2, 'the section names the reporter');
  for (const args of calls) {
    if (args.includes('…')) continue;
    const parts = args.split(',').map((part) => part.trim());
    assert.equal(parts.length, 5, `five arguments, no retry: reportPageError(${args})`);
    assert.match(parts[4], /^'(?:read|write)'$/, `the kind is the fifth argument: ${args}`);
    assert.equal(parts[0], 'PAGE_NAME');
  }
  assert.match(body, /with \*\*no retry argument\*\*/);
  assert.match(body, /never a row, a reference pair or a returned success payload/);
  assert.match(body, /a thrown read is never cached as unknown, no match, rows or success/);
});
