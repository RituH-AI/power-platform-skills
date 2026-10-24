'use strict';
// The teaching examples a page builder copies, graded by the evaluators a generated page meets. Each reference shows a
// whole PageBody (and its top-level helpers) built on the page error block references/rules.md publishes ("Missing Error
// Handling"); here that block — copied unchanged up to its own example PageBody — and the document's code are put together
// into the complete page a builder would write, and that page must pass the page error contract
// (lib/page-error-evidence.js) and, for a Custom API, the runtime check of lib/custom-api-contract.js. The built-in
// operations' generated call is graded the same way in built-in-operation-pattern.test.js. A document that drifts back to
// a try/catch that sets a string, logs the thrown value or calls trackException itself fails here, not in a generated page.
// Each page is also transpiled with the TypeScript the plugin vendors — a syntax check, not a type check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pageErrorProblems } = require('../lib/page-error-evidence.js');
const { runtimeProblems } = require('../lib/custom-api-contract.js');
const { loadVendoredTypeScript } = require('../../../../plugins/model-apps/scripts/lib/typescript-compiler.js');

const PLUGIN = path.join(__dirname, '..', '..', '..', '..', 'plugins', 'model-apps');
const read = (...parts) => fs.readFileSync(path.join(PLUGIN, ...parts), 'utf8').replace(/\r\n/g, '\n');
const RULES = read('references', 'rules.md');
const ERRORS = RULES.slice(RULES.indexOf('\n### 2. Missing Error Handling\n'), RULES.indexOf('\n### 3. '));
const RULE_BLOCKS = [...ERRORS.matchAll(/```tsx\n([\s\S]*?)\n```/g)].map((match) => match[1]);
const FOUNDATION = RULE_BLOCKS.find((block) => /\bfunction reportPageError\(/.test(block));
const TELEMETRY = RULE_BLOCKS.find((block) => /appInsights\?\.trackException\?\.\(/.test(block));
const PREFIX = FOUNDATION.slice(0, FOUNDATION.indexOf('function PageBody('));
const WRAPPER = FOUNDATION.slice(FOUNDATION.indexOf('const GeneratedComponent = '));

// Fenced blocks, including the ones indented under a list item (their closing fence carries the same indentation).
const codeBlocks = (text) => [...text.matchAll(/^([ \t]*)```(?:typescript|tsx)\n([\s\S]*?)\n\1```/gm)].map((match) => match[2]);
// The blocks of a document that hold a whole PageBody.
const bodies = (text) => codeBlocks(text).filter((code) => /^function PageBody\(/m.test(code));
// The complete page: the canonical block up to its own example PageBody, the document's code, then the canonical wrapper
// unless the document shows its own.
const complete = (code, prefix = PREFIX) => `${prefix}${code}\n\n${/^export default GeneratedComponent;$/m.test(code) ? '' : WRAPPER}\n`;
// The documented telemetry insertion goes right after the reporter's console.error line.
function withTelemetry(source) {
  const lines = source.split('\n');
  const at = lines.findIndex((line) => /^\s*console\.error\(/.test(line));
  assert.ok(at > 0 && TELEMETRY, 'rules.md publishes the reporter and its telemetry insertion');
  return [...lines.slice(0, at + 1), ...TELEMETRY.split('\n'), ...lines.slice(at + 1)].join('\n');
}
let typescript;
function parses(source, label) {
  typescript ||= loadVendoredTypeScript();
  const { diagnostics } = typescript.transpileModule(source, {
    fileName: 'page.tsx',
    reportDiagnostics: true,
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020, jsx: typescript.JsxEmit.React },
  });
  assert.deepEqual((diagnostics || []).map((entry) => typescript.flattenDiagnosticMessageText(entry.messageText, '\n')), [], `${label} parses`);
}
// One textual change; a change that does not apply is a broken test, never a pass.
function swap(source, from, to) {
  assert.ok(source.includes(from), `the example holds: ${from}`);
  return source.replace(from, to);
}

const DOCS = {
  caching: read('references', 'data-caching.md'),
  customApi: read('references', 'custom-api.md'),
  connectors: read('references', 'connectors.md'),
  localization: read('references', 'localization.md'),
  telemetry: read('references', 'page-telemetry.md'),
  builtIns: read('references', 'dataverse-operations.md'),
  builder: read('agents', 'genpage-page-builder.md'),
};
const [CACHE_LIST, CACHE_RECORD] = bodies(DOCS.caching);
const [ACTION, FUNCTION] = bodies(DOCS.customApi);
const [CONNECTOR_TABLE, CONNECTOR_OPERATION] = bodies(DOCS.connectors);
const [SETTINGS] = bodies(DOCS.localization);
// The telemetry reference also shows the prop declaration around an empty PageBody; its example page is the one that saves.
const TELEMETRY_SAVE = bodies(DOCS.telemetry).find((code) => /'saveOrder'/.test(code));
// A localized page keeps the reference's top-level language resolver beside the block.
const LANGUAGE = codeBlocks(DOCS.localization).find((code) => /^function resolvePageLanguage\(\)/m.test(code));
const PAGES = {
  'data-caching.md Pattern 1 (list)': CACHE_LIST && complete(CACHE_LIST),
  'data-caching.md Pattern 2 (detail)': CACHE_RECORD && complete(CACHE_RECORD),
  'custom-api.md Action': ACTION && complete(ACTION),
  'custom-api.md Function': FUNCTION && complete(FUNCTION),
  'connectors.md tabular read': CONNECTOR_TABLE && complete(CONNECTOR_TABLE),
  'connectors.md REST operation': CONNECTOR_OPERATION && complete(CONNECTOR_OPERATION),
  'localization.md usersettings read': SETTINGS && LANGUAGE && complete(`${LANGUAGE}\n\n${SETTINGS}`),
  'page-telemetry.md failed-save report': TELEMETRY_SAVE && complete(TELEMETRY_SAVE, withTelemetry(PREFIX)),
};

test('each reference shows a complete PageBody, and each passes the page error contract as a whole page', () => {
  assert.ok(FOUNDATION, 'rules.md publishes the canonical page error block');
  for (const [label, page] of Object.entries(PAGES)) {
    assert.ok(page, `${label}: the reference shows a whole PageBody built on the page error block`);
    assert.deepEqual(pageErrorProblems(page), [], label);
    parses(page, label);
  }
});

test('the Custom API Action and Function examples also pass the Custom API runtime check, through the boundary wrapper', () => {
  const action = { name: 'new_ApproveOrder', isFunction: false, boundEntityLogicalName: 'salesorder', displayName: 'Approve Order', parameterKinds: { Comment: 'String' } };
  const fn = { name: 'new_GetOrderSummary', isFunction: true, displayName: 'Order summary', parameterKinds: { OrderId: 'Guid' } };
  assert.deepEqual(runtimeProblems(PAGES['custom-api.md Action'], [action], { new_ApproveOrder: ['NewStatus'] }, new Map()), []);
  assert.deepEqual(runtimeProblems(PAGES['custom-api.md Function'], [fn], { new_GetOrderSummary: ['Total'] }, new Map()), []);
  // The order is part of the contract: each guard reports, stores the view and returns before the outputs, a network result
  // offers the named manual retry and nothing else does.
  for (const [label, page] of [['Action', PAGES['custom-api.md Action']], ['Function', PAGES['custom-api.md Function']]]) {
    const guards = ['if (res.indeterminate)', "if (res.error?.code === 'indeterminate')", "if (!res.ok && res.error?.code === 'network')", 'if (!res.ok)', 'res.outputs?.'];
    const at = guards.map((guard) => page.indexOf(guard));
    assert.ok(at.every((index, i) => index > 0 && (i === 0 || index > at[i - 1])), `${label}: the guards in order before the outputs (${at})`);
  }
  assert.doesNotMatch(DOCS.customApi, /setError\(|res\.error\?\.message \?\? 'The action failed\.'/, 'no string error state is left in the Custom API reference');
});

test('the telemetry example instruments only the save it was asked about, and only the reporter sends an exception', () => {
  const page = PAGES['page-telemetry.md failed-save report'];
  const reports = [...TELEMETRY_SAVE.matchAll(/\breportPageError\(/g)].map((match) => callArguments(TELEMETRY_SAVE, match.index + match[0].length - 1).join(', '));
  assert.deepEqual(reports, ["PAGE_NAME, 'saveOrder', undefined, error, 'write', undefined, appInsights"], 'one report, the save, carries the appInsights prop');
  assert.doesNotMatch(TELEMETRY_SAVE, /\.trackException\s*(?:\?\.\s*)?\(/, 'the page never calls trackException itself');
  assert.doesNotMatch(page.slice(page.indexOf('const GeneratedComponent')), /appInsights=/, 'a save-only request leaves the boundary as it is');
  // The other GOOD shapes report their failures with no telemetry argument: those requests measure, they do not report failures.
  const known = DOCS.telemetry.slice(DOCS.telemetry.indexOf('\n## 4. Known-good shapes\n'), DOCS.telemetry.indexOf('\n## 5. Anti-patterns\n'));
  assert.doesNotMatch(known, /\.trackException\s*(?:\?\.\s*)?\(/, 'no known-good shape calls trackException');
  for (const code of codeBlocks(known)) {
    for (const call of code.matchAll(/\breportPageError\(/g)) {
      const args = callArguments(code, call.index + call[0].length - 1);
      if (args.includes("'saveOrder'")) continue;
      assert.ok(args.length === 5, `a report outside the failed-save example hands no retry or telemetry: ${args.join(', ')}`);
    }
  }
  // The trigger row for failures names the reporter, not catch-block trackException calls.
  const triggers = DOCS.telemetry.slice(DOCS.telemetry.indexOf('\n### Trigger patterns\n'), DOCS.telemetry.indexOf('\n## 2. The API\n'));
  assert.doesNotMatch(triggers, /`trackException\(err, \{ \.\.\. \}\)` in the relevant `catch` blocks/);
  assert.match(triggers, /\| "report failed saves" \| the same insertion, and `props\.appInsights` as the seventh argument of the save's reports \*\*only\*\*/);
});

// A call's top-level argument texts: brackets, strings and template literals are skipped over, so a comma inside them does
// not split. Enough for the documents' own examples; a malformed call fails the count check below.
function callArguments(code, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '\'' || ch === '"' || ch === '`') {
      for (i += 1; i < code.length && code[i] !== ch; i += 1) if (code[i] === '\\') i += 1;
    } else if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      if (depth === 0) { args.push(code.slice(start, i).trim()); return args; }
      depth -= 1;
    } else if (ch === ',' && depth === 0) { args.push(code.slice(start, i).trim()); start = i + 1; }
  }
  return null;
}

test('every reportPageError call the teaching documents show has the five required arguments and a literal kind', () => {
  const documents = { 'rules.md': RULES, ...Object.fromEntries(Object.entries(DOCS).map(([key, text]) => [key, text])) };
  let seen = 0;
  for (const [name, text] of Object.entries(documents)) {
    for (const code of codeBlocks(text)) {
      for (const call of code.matchAll(/(?<!function\s)\breportPageError\(/g)) {
        const args = callArguments(code, call.index + call[0].length - 1);
        assert.ok(args, `${name}: a reportPageError call closes`);
        seen += 1;
        const shown = `${name}: reportPageError(${args.join(', ')})`;
        assert.ok(args.length >= 5 && args.length <= 7, `${shown} has five to seven arguments`);
        assert.match(args[4], /^(['"])(?:read|write|indeterminate|network|render)\1$/, `${shown} has a literal kind at index 4`);
        assert.match(args[1], /^(['"])[A-Za-z][\w]*\1$/, `${shown} names its operation with one stable literal`);
        if (['write', 'indeterminate', 'render'].includes(args[4].slice(1, -1))) assert.ok(!args[5] || args[5] === 'undefined', `${shown} offers no retry`);
      }
    }
  }
  assert.ok(seen >= 40, `the documents show the reporter in use (${seen} calls)`);
});

test('the documents no longer teach a bare try/catch error string or a logged thrown value', () => {
  assert.doesNotMatch(DOCS.caching, /error: "Unable to load records\."|error: "Unable to load record\."|error: string \| null/);
  assert.doesNotMatch(DOCS.localization, /console\.error\("Failed to fetch user settings", error\)/);
  assert.doesNotMatch(DOCS.connectors, /if \(!response\.ok\) \{ return; \}/);
  assert.doesNotMatch(DOCS.builder, /setError\(|if \(!response\.ok\) \{ return; \}/);
  for (const [name, text] of Object.entries(DOCS)) {
    for (const code of codeBlocks(text)) assert.doesNotMatch(code, /console\.(?:error|log|warn)\([^)]*\berror\b\s*\)/, `${name} logs no thrown value`);
  }
});

test('negative controls: each example fails the contract when its failure path is taken away', () => {
  const problems = (source) => pageErrorProblems(source);
  for (const [label, source, reason] of [
    ['a list read whose catch stores a string', swap(PAGES['data-caching.md Pattern 1 (list)'],
      'error: reportPageError(PAGE_NAME, "loadRecords", undefined, failure, "read", retryLoad) }',
      'error: null }'), /does not report through reportPageError/],
    ['an Action that skips the code-only indeterminate result', swap(PAGES['custom-api.md Action'],
      "      if (res.error?.code === 'indeterminate') { setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', res.error?.code, res.error?.message, 'indeterminate')); return; }\n",
      ''), /res\.error\?\.code === 'indeterminate'/],
    ['an operation response read before ok is checked', swap(PAGES['connectors.md REST operation'],
      "      if (!response.ok) { setWeather({ weather: null, error: reportPageError(PAGE_NAME, 'loadWeather', undefined, undefined, 'read', retryWeather) }); return; }\n",
      ''), /response is not checked/],
    ['a settings read that logs the error instead', swap(PAGES['localization.md usersettings read'],
      'setSettings({ userSettings: null, settingsError: reportPageError(PAGE_NAME, "loadUserSettings", undefined, error, "read") })',
      'console.error("settings", error)'), /does not report through reportPageError/],
    ['a page that calls trackException itself', swap(PAGES['page-telemetry.md failed-save report'],
      "            setSave({ saving: false, error: reportPageError(PAGE_NAME, 'saveOrder', undefined, error, 'write', undefined, appInsights) });",
      "            (appInsights as any)?.trackException?.(error);\n            setSave({ saving: false, error: reportPageError(PAGE_NAME, 'saveOrder', undefined, error, 'write', undefined, appInsights) });"), /only reportPageError may call trackException/],
    ['a write that offers a retry', swap(PAGES['custom-api.md Action'],
      "res.error?.message, 'write')); return; }", "res.error?.message, 'write', retryApprove)); return; }"), /a write failure never offers a retry/],
  ]) {
    const found = problems(source);
    assert.ok(found.some((problem) => reason.test(problem)), `${label}: ${JSON.stringify(found)}`);
  }
});
