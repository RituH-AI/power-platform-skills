'use strict';
// The page error contract (references/rules.md, "Missing Error Handling"), read from a generated page's source: every
// supported dataApi failure goes through the page's one canonical reportPageError, the view it returns reaches state a
// PageErrorBar renders, and the page renders inside PageErrorBoundary. One evaluator, shared by the Layer-2 assertion
// and by any Layer-1 expectation that needs the same answer, so the two layers cannot disagree.
//
// This is a FINITE, fail-closed grammar, not a control-flow proof. The source is read, never run (source-evidence.js):
// a shape outside the grammar is reported as unverifiable, never passed or skipped. Accepted shapes, each with the
// page's real code reachable from the canonical boundary wrapper:
//   1. direct await — `await <dataApi>.<method>(…)`, not chained, in a `try` of the SAME function, whose `catch` reports and
//      stores the view in a statement of its own (only a staleness guard — a cancelled or unmounted flag set in a
//      cleanup, a request counter, a context snapshot — may return first, or keep the report under its fresh condition);
//   2. returned view — a named request helper catches/handles the failure and returns `{ error: view }`; every caller
//      awaits it and stores the error in rendered state (one helper→caller edge, plus a recognized setter adapter);
//   3. canonical cache — the data call roots a `.then/.finally` chain held by one binding (a `const`/`let` initializer,
//      or the guarded `if (!slot) { slot = …; <window or Map slot> = slot; }` assignment of data-caching.md), and the
//      SAME binding later gets the consumer `.then(…).catch(…)` whose handler reports and never writes the cache;
//   4. result envelopes — a Custom API result checks `res.indeterminate`, then `res.error?.code === 'indeterminate'`,
//      then (optionally) network, then `!res.ok`, each reporting before it returns and all before `res.outputs`; a
//      built-in WhoAmI/RetrieveVersion result checks `res.ok` and reports a read; a connector operation checks
//      `response.ok` before `response.body`;
//   5. grouped reads — `Promise.all` over named returned-view helpers, or a fixed `Promise.allSettled` tuple with a
//      `<item>.status === 'rejected'` report of `<item>.reason` for every item;
//   6. boundary and UI — the default export is exactly the canonical wrapper (source-evidence.js forwardedPageBodyOf),
//      PageErrorBoundary and PageErrorBar have the canonical shape, and every stored view is rendered by a PageErrorBar.
// The reporter itself must be the canonical function of rules.md, line for line (comments, indentation and line endings
// aside), bound once, with only the documented telemetry insertion allowed; it alone may call trackException. Every call
// has five to seven arguments, a literal kind at index 4, a literal operation, no retry on a write, indeterminate or
// render failure, and a built-in failure is a read with no retry. `loadMoreRows` and the synchronous `setPageOutput` are
// outside this inventory by design; `retrieveMultipleRecords` is not a page DataAPI method and is flagged.
//
// Pages captured before the contract existed are exempt only while their source is byte-for-byte what was captured
// (page-error-allowlist.json: fixture-relative path + SHA-256 of the UTF-8 text with CRLF converted to LF, nothing else
// normalized). A changed page at the same path, a new path, and the contract's own fixtures are always graded.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { blankNonCodePreservingTemplateExpressions } = require('../../../../plugins/model-apps/scripts/lib/source-literals.js');
const { groupEnd, literalString, escapeRe, callSites, receiverIsDataApi, namedScopes, forwardedPageBodyOf } = require('./source-evidence.js');
const { jsxElements, functionScopes, namedFunctions } = require('./tsx-structure.js');
const { canonicalLines, depthAt, topLevelFunction, canonicalReporter, canonicalBars } = require('./page-error-canonical.js');

const PAGE_ERROR_ASSERTION = 'Generated .tsx routes every supported dataApi failure through reportPageError and mounts PageErrorBoundary around PageBody';
const LISTED_METHODS = ['queryTable', 'retrieveRow', 'createRow', 'updateRow', 'deleteRow', 'getChoices', 'queryConnectorTable',
  'executeConnectorOperation', 'executeAction', 'executeFunction', 'listBoundActions'];
const KINDS = new Set(['read', 'write', 'indeterminate', 'network', 'render']);
const BUILT_INS = new Set(['WhoAmI', 'RetrieveVersion']);
const REPORTER = 'reportPageError';
const LEDGER_PATH = path.join(__dirname, 'page-error-allowlist.json');

// ---------- small lexical helpers over the masked source ----------

// The [start, end) ranges of the top-level arguments of the call whose `(` is at `open`. A trailing comma after the last
// argument (`f(a, b,)`, valid since ES2017) passes no argument: the empty text after it is not one.
function argRanges(mask, open) {
  const close = groupEnd(mask, open);
  const ranges = [];
  let start = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    if ('({['.includes(mask[i])) { i = groupEnd(mask, i); continue; }
    if (mask[i] === ',') { ranges.push([start, i]); start = i + 1; }
  }
  if (mask.slice(start, close).trim()) ranges.push([start, close]);
  return { close, args: ranges.map(([a, b]) => trimRange(mask, a, b)) };
}
function trimRange(mask, a, b) {
  while (a < b && /\s/.test(mask[a])) a += 1;
  while (b > a && /\s/.test(mask[b - 1])) b -= 1;
  return [a, b];
}
const squash = (text) => String(text).replace(/\s+/g, '').replace(/\?\./g, '.').replace(/"/g, "'");
const IDENT = '[A-Za-z_$][\\w$]*';
const CHAIN = new RegExp(`^${IDENT}(?:\\.${IDENT})*$`);

// The innermost function body (tsx-structure functionScopes: arrows, function declarations and expressions) around `at`.
function innermostFunction(ctx, at) {
  let best = null;
  for (const scope of ctx.functions) if (scope.start < at && at < scope.end && (!best || scope.end - scope.start < best.end - best.start)) best = scope;
  return best;
}

// The `{ … }` of a `try` around `at` whose innermost function is the call's own, innermost first: [{ tryAt, open, close }].
function enclosingTries(ctx, at) {
  const own = innermostFunction(ctx, at);
  const tries = [];
  for (const match of ctx.mask.matchAll(/\btry\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    const close = groupEnd(ctx.mask, open);
    if (open < at && at < close && innermostFunction(ctx, match.index) === own) tries.push({ tryAt: match.index, open, close });
  }
  return tries.sort((a, b) => b.open - a.open);
}

// The `catch` clause right after a try block: { param, open, close } or null (a try with only `finally`).
function catchAfter(ctx, close) {
  const clause = new RegExp(`^\\s*catch\\s*(?:\\(\\s*(${IDENT})[^)]*\\))?\\s*\\{`).exec(ctx.mask.slice(close + 1));
  if (!clause) return null;
  const open = close + 1 + clause[0].length - 1;
  return { param: clause[1] || null, open, close: groupEnd(ctx.mask, open) };
}

// ---------- staleness: what says an answer is no longer wanted ----------
// A failure may go unreported only when nobody waits for it any more, and the guard that says so is read from a closed
// set of terms, each tied to the one thing that makes it a staleness signal:
//   - a request counter: `requestId !== <ref>.current`, the ref counted up for every request (`++<ref>.current`) and
//     `requestId` taken from it (`const requestId = ++<ref>.current`);
//   - a context snapshot: `<snapshot> !== <ref>.current`, the ref holding the context the page now shows — set from page
//     state (`<ref>.current = recordId`), never true/false and never counted (the record an approval belongs to);
//   - an unmounted flag: `!<ref>.current`, the ref set false only in an effect's cleanup (`return () => { … }`);
//   - a cancelled flag: a `let` that starts false and is set true only in an effect's cleanup.
// An early return needs a STALE condition — those terms joined by `||` — and a report kept under an `if` needs the FRESH
// condition — the opposite terms (`requestId === <ref>.current`, `<ref>.current`, `!cancelled`) joined by `&&`. A latch
// (`pending.current`, set before a call and reset in its `finally`), page data or state is no staleness signal: returning
// on it, or reporting only under it, can skip a live failure. Anything else is refused.
const isRef = (ctx, name) => new RegExp(`\\b(?:const|let)\\s+${escapeRe(name)}\\s*=\\s*(?:React\\s*\\.\\s*)?useRef\\b`).test(ctx.mask);
// Every write to `<name>.current`: { at, op, value } — `++`/`--` (either side), `+=`-style or a plain `=` and its value.
function refWrites(ctx, name) {
  const id = escapeRe(name);
  const out = [];
  for (const m of ctx.mask.matchAll(new RegExp(`(?:\\+\\+|--)\\s*${id}\\s*\\.\\s*current\\b`, 'g'))) out.push({ at: m.index, op: 'count' });
  for (const m of ctx.mask.matchAll(new RegExp(`(?<![\\w$.])${id}\\s*\\.\\s*current\\s*(\\+\\+|--|[-+*/%]=|=(?![=>]))\\s*([^;\\n]*)`, 'g'))) {
    out.push({ at: m.index, op: m[1] === '=' ? 'set' : 'count', value: m[2].trim() });
  }
  return out;
}
// Inside a cleanup an effect returns: the innermost function is a parameterless arrow that is returned (`return () => …`)
// or is the body of the effect's own arrow (`useEffect(() => () => …, […])`).
function inCleanup(ctx, at) {
  const fn = innermostFunction(ctx, at);
  if (!fn) return false;
  const arrow = /\(\s*\)\s*=>\s*$/.exec(ctx.mask.slice(0, fn.start));
  if (!arrow) return false;
  return /(?:\breturn|=>)\s*$/.test(ctx.mask.slice(0, arrow.index));
}
function counterRef(ctx, name, snapshot) {
  return isRef(ctx, name) && refWrites(ctx, name).some((write) => write.op === 'count')
    && new RegExp(`\\bconst\\s+${escapeRe(snapshot)}\\s*=\\s*\\+\\+\\s*${escapeRe(name)}\\s*\\.\\s*current\\b`).test(ctx.mask);
}
function contextRef(ctx, name) {
  if (!isRef(ctx, name)) return false;
  const writes = refWrites(ctx, name);
  return writes.length > 0 && writes.every((write) => write.op === 'set' && !/^(?:true|false)\b/.test(write.value));
}
function mountedRef(ctx, name) {
  if (!isRef(ctx, name)) return false;
  const writes = refWrites(ctx, name);
  const cleared = writes.filter((write) => write.op === 'set' && /^false\b/.test(write.value));
  return cleared.length > 0 && cleared.every((write) => inCleanup(ctx, write.at))
    && writes.every((write) => write.op === 'set' && /^(?:true|false)\b/.test(write.value));
}
function cancelledFlag(ctx, name) {
  const id = escapeRe(name);
  if (!new RegExp(`\\b(?:let|var)\\s+${id}\\s*(?::\\s*boolean\\s*)?=\\s*false\\b`).test(ctx.mask)) return false;
  const writes = [...ctx.mask.matchAll(new RegExp(`(?<![\\w$.])${id}\\s*=(?![=>])\\s*([^;\\n]*)`, 'g'))]
    .filter((write) => !/\b(?:let|var)\s+$/.test(ctx.mask.slice(Math.max(0, write.index - 6), write.index)));
  return writes.length > 0 && writes.every((write) => /^true\b/.test(write[1].trim()) && inCleanup(ctx, write.index));
}
// The terms of a guard condition joined by `joiner` (`||` or `&&`), each without its own parentheses; null when the
// condition mixes in anything else.
function guardTerms(text, joiner) {
  let body = String(text).trim();
  while (/^\(([\s\S]*)\)$/.test(body) && groupEnd(body, 0) === body.length - 1) body = body.slice(1, -1).trim();
  const other = joiner === '||' ? '&&' : '||';
  if (body.includes(other) || /[?:]/.test(body)) return null;
  return body.split(joiner).map((term) => term.trim().replace(/^\((.*)\)$/, '$1').trim());
}
function staleTerm(ctx, term) {
  let m = new RegExp(`^(${IDENT})\\s*!==?\\s*(${IDENT})\\s*\\.\\s*current$`).exec(term)
    || new RegExp(`^(${IDENT})\\s*\\.\\s*current\\s*!==?\\s*(${IDENT})$`).exec(term);
  if (m) {
    const [snapshot, ref] = /\.\s*current/.test(term.split(/!==?/)[0]) ? [m[2], m[1]] : [m[1], m[2]];
    return counterRef(ctx, ref, snapshot) || contextRef(ctx, ref);
  }
  if ((m = new RegExp(`^!\\s*(${IDENT})\\s*\\.\\s*current$`).exec(term))) return mountedRef(ctx, m[1]);
  if ((m = new RegExp(`^(${IDENT})$`).exec(term))) return cancelledFlag(ctx, m[1]);
  return false;
}
function freshTerm(ctx, term) {
  let m = new RegExp(`^(${IDENT})\\s*===?\\s*(${IDENT})\\s*\\.\\s*current$`).exec(term)
    || new RegExp(`^(${IDENT})\\s*\\.\\s*current\\s*===?\\s*(${IDENT})$`).exec(term);
  if (m) {
    const [snapshot, ref] = /\.\s*current/.test(term.split(/===?/)[0]) ? [m[2], m[1]] : [m[1], m[2]];
    return counterRef(ctx, ref, snapshot) || contextRef(ctx, ref);
  }
  if ((m = new RegExp(`^(${IDENT})\\s*\\.\\s*current$`).exec(term))) return mountedRef(ctx, m[1]);
  if ((m = new RegExp(`^!\\s*(${IDENT})$`).exec(term))) return cancelledFlag(ctx, m[1]);
  return false;
}
// `if (<text>) return;` may skip a report only when <text> says the answer is stale.
function staleCondition(ctx, text) {
  const terms = guardTerms(text, '||');
  return Boolean(terms && terms.length && terms.every((term) => staleTerm(ctx, term)));
}
// `if (<text>) <report>` may hold a report only when <text> says the answer is still wanted.
function freshCondition(ctx, text) {
  const terms = guardTerms(text, '&&');
  return Boolean(terms && terms.length && terms.every((term) => freshTerm(ctx, term)));
}

// ---------- context ----------

function context(code) {
  const mask = blankNonCodePreservingTemplateExpressions(code);
  const ctx = { code, mask, scopes: namedScopes(mask), functions: functionScopes(mask), named: namedFunctions(mask) };
  ctx.states = useStates(ctx);
  ctx.adapters = adapters(ctx);
  ctx.reportSites = callSites(mask, REPORTER).map((site) => {
    const open = mask.indexOf('(', site.at);
    const { close, args } = argRanges(mask, open);
    return { at: site.at, open, close, args, text: (index) => (args[index] ? code.slice(args[index][0], args[index][1]) : undefined) };
  });
  // Only a bar that is shown whenever its component renders proves a stored view is seen (reachableBar).
  ctx.barElements = jsxElements(mask, new Set(['PageErrorBar']));
  ctx.bars = ctx.barElements.filter((element) => reachableBar(ctx, element)).map((element) => element.attrs.get('error'))
    .filter((attr) => attr && attr.kind === 'expression')
    .map((attr) => squash(attr.value).replace(/(?:\?\?|\|\|)(?:null|undefined)$/, ''));
  return ctx;
}

// A <PageErrorBar> is shown whenever its component renders only when it sits in the component's final `return (…)` —
// an unconditional statement of the body, with no unconditional return before it — and inside JSX elements only, never
// in a `{…}` expression (a condition, a ternary, a map callback) that may leave it out. Render each bar there: it shows
// nothing until there is an error. A bar anywhere else proves nothing about the state it names.
function unconditionalStatement(mask, at, bodyOpen) {
  if (enclosingBlock(mask, at) !== bodyOpen) return false;
  const prev = previousToken(mask, at);
  return !(mask[prev] === ')' && ifHead(mask, prev)) && !/\belse\s*$/.test(mask.slice(0, at));
}
function reachableBar(ctx, element) {
  const { mask } = ctx;
  const fn = innermostFunction(ctx, element.start);
  const component = fn && ctx.named.find((entry) => entry.body.start === fn.start && entry.body.end === fn.end);
  if (!component || depthAt(mask, component.start) !== 0 || mask[fn.start] !== '{') return false;
  // The brackets still open between the body and the element: at most the `(` of `return (`.
  const openers = [];
  let depth = 0;
  for (let i = element.start - 1; i > fn.start; i -= 1) {
    if (')}]'.includes(mask[i])) depth += 1;
    else if ('({['.includes(mask[i])) {
      if (depth > 0) depth -= 1;
      else openers.push(i);
    }
  }
  if (openers.length > 1 || (openers.length === 1 && mask[openers[0]] !== '(')) return false;
  const keyword = /\breturn\s*$/.exec(mask.slice(0, openers.length ? openers[0] : element.start));
  if (!keyword || !unconditionalStatement(mask, keyword.index, fn.start)) return false;
  return ![...mask.slice(fn.start + 1, keyword.index).matchAll(/\breturn\b/g)]
    .some((match) => unconditionalStatement(mask, fn.start + 1 + match.index, fn.start));
}

// `const [x, setX] = (React.)useState…` → setter → { name, keys } where keys maps an object pattern's keys to locals.
function useStates(ctx) {
  const states = new Map();
  const re = new RegExp(`\\b(?:const|let)\\s*\\[\\s*(\\{[^}]*\\}|${IDENT})\\s*,\\s*(${IDENT})\\s*\\]\\s*=\\s*(?:React\\s*\\.\\s*)?useState\\b`, 'g');
  for (const match of ctx.mask.matchAll(re)) {
    const pattern = match[1];
    if (pattern.startsWith('{')) {
      const keys = new Map();
      for (const entry of pattern.slice(1, -1).split(',').map((part) => part.trim()).filter(Boolean)) {
        const parts = new RegExp(`^(${IDENT})(?:\\s*:\\s*(${IDENT}))?$`).exec(entry);
        if (parts) keys.set(parts[1], parts[2] || parts[1]);
      }
      states.set(match[2], { name: null, keys });
    } else states.set(match[2], { name: pattern, keys: null });
  }
  return states;
}

// A named function of one parameter whose whole body is one setter call storing that parameter — directly or as one
// property of an object literal: `function setActionFailure(view) { setAction({ pending: false, error: view }); }`.
function adapters(ctx) {
  const found = new Map();
  for (const fn of ctx.named) {
    if (fn.params.length !== 1) continue;
    const body = ctx.mask.slice(fn.body.start, fn.body.end).trim().replace(/^\{/, '').replace(/\}$/, '').trim().replace(/;$/, '').replace(/^return\s+/, '');
    const call = new RegExp(`^(${IDENT})\\s*\\(([\\s\\S]*)\\)$`).exec(body);
    if (!call || !ctx.states.has(call[1])) continue;
    const argument = call[2].trim();
    if (argument === fn.params[0]) { found.set(fn.name, { setter: call[1], path: [] }); continue; }
    const key = objectKeyOf(argument, fn.params[0]);
    if (key) found.set(fn.name, { setter: call[1], path: [key] });
  }
  return found;
}

// In an object literal's text, the key whose value is exactly `value` (`key: value` or the shorthand `value`).
function objectKeyOf(text, value) {
  if (!/^\{[\s\S]*\}$/.test(text.trim())) return null;
  const inner = text.trim().slice(1, -1);
  for (const entry of splitTop(inner)) {
    const pair = new RegExp(`^(${IDENT})\\s*:\\s*([\\s\\S]+)$`).exec(entry.trim());
    if (pair && pair[2].trim() === value) return pair[1];
    if (entry.trim() === value) return value;
  }
  return null;
}
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if ('({['.includes(text[i])) depth += 1;
    else if (')}]'.includes(text[i])) depth -= 1;
    else if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.filter((part) => part.trim());
}

// ---------- where a reported view goes ----------

// Is the error stored under `path` of setter `setter`'s state rendered by some <PageErrorBar error={…} />?
function rendered(ctx, setter, pathParts) {
  const state = ctx.states.get(setter);
  if (!state) return false;
  let expected;
  if (state.name) expected = [state.name, ...pathParts].join('.');
  else {
    const [key, ...rest] = pathParts;
    if (!key || !state.keys.has(key)) return false;
    expected = [state.keys.get(key), ...rest].join('.');
  }
  return ctx.bars.includes(expected);
}

// Where the value of the expression at [start, end) goes, read from what surrounds it:
//   { kind: 'setter', setter, path }  — an argument of a state setter or adapter, alone or as an object property
//   { kind: 'returned', path }        — returned in an object literal (`return { error: view }`)
//   { kind: 'variable', name, path }  — the initializer of a declaration (`const view = …`), or assigned to a `let`
//   { kind: 'discarded' }             — an expression statement of its own
//   { kind: 'unknown' }               — anything else
// Each known destination also carries its `anchor`: where the statement that stores (or returns, or declares) the value
// starts — the setter's or adapter's name, the declaration keyword, the assigned name or `return`.
function destination(ctx, start, end, pathParts = []) {
  const { mask } = ctx;
  let before = start - 1;
  while (before >= 0 && /\s/.test(mask[before])) before -= 1;
  let after = end;
  while (after < mask.length && /\s/.test(mask[after])) after += 1;
  const ch = mask[before];
  const bare = new RegExp(`^${IDENT}$`).test(mask.slice(start, end));
  if (ch === '(' ) {
    const callee = new RegExp(`(${IDENT})\\s*$`).exec(mask.slice(0, before));
    if (callee && mask[after] === ')' && (ctx.states.has(callee[1]) || ctx.adapters.has(callee[1]))) {
      const adapter = ctx.adapters.get(callee[1]);
      return adapter ? { kind: 'setter', setter: adapter.setter, path: [...adapter.path, ...pathParts], anchor: callee.index }
        : { kind: 'setter', setter: callee[1], path: pathParts, anchor: callee.index };
    }
    return { kind: 'unknown' };
  }
  // A property value — `key: <expr>`, or the shorthand `{ …, name }` of a bare name — inside an object literal, whose
  // `{` decides where the object goes.
  const key = ch === ':' ? new RegExp(`(${IDENT})\\s*$`).exec(mask.slice(0, before))?.[1]
    : ((ch === '{' || ch === ',') && bare ? mask.slice(start, end) : null);
  if (key && /^[,}]/.test(mask[after])) {
    const open = objectOpen(mask, before);
    if (open < 0) return { kind: 'unknown' };
    const close = groupEnd(mask, open);
    return destination(ctx, open, close + 1, [key, ...pathParts]);
  }
  if (ch === ':' || ch === ',') return { kind: 'unknown' };
  if (ch === '=' && mask[before - 1] !== '=' && mask[before - 1] !== '!' && mask[before - 1] !== '>' && mask[before - 1] !== '<') {
    const decl = new RegExp(`\\b(?:const|let|var)\\s+(${IDENT})\\s*(?::[^=;]+)?$`).exec(mask.slice(0, before));
    if (decl) return { kind: 'variable', name: decl[1], declared: true, at: start, path: pathParts, anchor: decl.index };
    const assigned = new RegExp(`(?<![\\w$.])(${IDENT})\\s*$`).exec(mask.slice(0, before));
    if (assigned) return { kind: 'variable', name: assigned[1], declared: false, at: start, path: pathParts, anchor: assigned.index };
    return { kind: 'unknown' };
  }
  const returned = /\breturn\s*$/.exec(mask.slice(0, start));
  if (returned) return { kind: 'returned', at: start, path: pathParts, anchor: returned.index };
  if ((before < 0 || /[;{}]/.test(ch)) && /^(?:;|\}|$)/.test(mask.slice(after, after + 1) || '') && !pathParts.length) return { kind: 'discarded', anchor: start };
  return { kind: 'unknown' };
}

// The `{` opening the object literal that the property ending at `at` belongs to.
function objectOpen(mask, at) {
  let depth = 0;
  for (let i = at; i >= 0; i -= 1) {
    if (')}]'.includes(mask[i])) depth += 1;
    else if ('({['.includes(mask[i])) {
      if (depth === 0) return mask[i] === '{' ? i : -1;
      depth -= 1;
    }
  }
  return -1;
}

// The uses of a variable holding a view, after `from` and inside its block: the built-in pattern may set its
// fallbackKey/message, then stores or returns it once. Returns the destinations of its other uses.
function variableDestinations(ctx, variable, scopeEnd) {
  const { mask } = ctx;
  const out = [];
  const re = new RegExp(`(?<![\\w$.])${escapeRe(variable.name)}(?![\\w$])`, 'g');
  for (const use of mask.slice(0, scopeEnd).matchAll(re)) {
    if (use.index <= variable.at) continue;
    const tail = mask.slice(use.index + variable.name.length);
    if (/^\s*\.\s*(?:fallbackKey|message)\s*=(?!=)/.test(tail)) continue;
    if (/^\s*\.\s*(?:fallbackKey|message)\b/.test(tail)) continue;
    // Replaced by another report (each allSettled item that failed) is still a reported view; replaced by anything else
    // (`view = null`), the stored value is no longer the one reportPageError returned.
    if (/^\s*=(?!=)\s*reportPageError\s*\(/.test(tail)) continue;
    if (/^\s*=(?!=)/.test(tail)) { out.push({ kind: 'overwritten', name: variable.name }); continue; }
    if (/^\s*:/.test(tail) && /[{,]\s*$/.test(mask.slice(0, use.index))) continue;
    out.push(destination(ctx, use.index, use.index + variable.name.length, variable.path));
  }
  return out;
}

// The block that holds `at`: the innermost `{ … }` around it.
function blockEnd(mask, at) {
  let depth = 0;
  for (let i = at; i < mask.length; i += 1) {
    if ('({['.includes(mask[i])) depth += 1;
    else if (')}]'.includes(mask[i])) {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return mask.length;
}

// Follow a view from a report call to state: problems, and `returned` when it leaves through `return { error: … }`
// (family 2 — the helper's callers are checked separately). A view that is stored must be rendered.
function followView(ctx, start, end, label) {
  const problems = [];
  const returned = [];
  const visit = (where, depth) => {
    if (depth > 4) { problems.push(`${label}: the reported view goes through too many hops to follow (unverifiable)`); return; }
    if (where.kind === 'setter') {
      if (!rendered(ctx, where.setter, where.path)) problems.push(`${label}: the error view stored by ${where.setter}(${where.path.length ? `…${where.path.join('.')}` : ''}) is never rendered by a <PageErrorBar error={…} />`);
      return;
    }
    if (where.kind === 'returned') {
      if (where.path.join('.') !== 'error') problems.push(`${label}: a returned view must be the \`error\` of the returned object`);
      else returned.push(where);
      return;
    }
    if (where.kind === 'variable') {
      const uses = variableDestinations(ctx, where, blockEnd(ctx.mask, where.at));
      if (!uses.length) problems.push(`${label}: the view kept in ${where.name} is never stored or returned (discarded)`);
      for (const use of uses) visit(use, depth + 1);
      return;
    }
    if (where.kind === 'discarded') { problems.push(`${label}: the view reportPageError returns is discarded`); return; }
    if (where.kind === 'overwritten') { problems.push(`${label}: the view kept in ${where.name} is overwritten before it is stored (unverifiable)`); return; }
    problems.push(`${label}: the view reportPageError returns does not reach state a PageErrorBar renders (unverifiable)`);
  };
  visit(destination(ctx, start, end), 0);
  return { problems, returned };
}

// ---------- the reporter and its calls ----------

function reporterProblems(ctx) {
  const problems = [];
  const { code, mask } = ctx;
  const declarations = [...mask.matchAll(new RegExp(`\\b(?:function|class|const|let|var)\\s+${REPORTER}(?![\\w$])`, 'g'))];
  const range = topLevelFunction(code, mask, REPORTER);
  if (!range) return [`no top-level function ${REPORTER} — copy the canonical reporter of references/rules.md`];
  if (declarations.length !== 1) problems.push(`${REPORTER} must be declared once (found ${declarations.length} declarations)`);
  if (new RegExp(`(?<![\\w$.])${REPORTER}\\s*=(?![=>])`).test(mask)) problems.push(`${REPORTER} is reassigned`);
  const lines = canonicalLines(code.slice(range.start, range.end)).join('\n');
  const { base, telemetry } = canonicalReporter();
  if (lines !== base && lines !== telemetry) problems.push(`${REPORTER} is not the canonical reporter of references/rules.md (only the documented telemetry insertion may be added)`);
  for (const mention of mask.matchAll(new RegExp(`(?<![\\w$.])${REPORTER}(?![\\w$])`, 'g'))) {
    if (mention.index === range.start + mask.slice(range.start).indexOf(REPORTER)) continue;
    if (/^\s*\(/.test(mask.slice(mention.index + REPORTER.length))) continue;
    problems.push(`${REPORTER} is handed on as a value; only direct calls are graded`);
    break;
  }
  for (const send of mask.matchAll(/\.\s*trackException\s*(?:\?\.\s*)?\(/g)) {
    if (send.index < range.start || send.index > range.end) { problems.push('only reportPageError may call trackException'); break; }
  }
  return problems;
}

// The parameter names of the function around `at` and of the catch clauses and `.catch(` handlers around it.
function caughtNames(ctx, at) {
  const names = new Set();
  for (const match of ctx.mask.matchAll(new RegExp(`\\bcatch\\s*\\(\\s*(${IDENT})`, 'g'))) {
    const open = ctx.mask.indexOf('{', match.index);
    if (open > 0 && open < at && at < groupEnd(ctx.mask, open)) names.add(match[1]);
  }
  for (const match of ctx.mask.matchAll(new RegExp(`\\.\\s*catch\\s*\\(\\s*\\(?\\s*(${IDENT})`, 'g'))) {
    const open = ctx.mask.indexOf('(', match.index);
    if (open < at && at < groupEnd(ctx.mask, open)) names.add(match[1]);
  }
  const method = new RegExp(`\\bcomponentDidCatch\\s*\\(\\s*(${IDENT})`).exec(ctx.mask);
  if (method) names.add(method[1]);
  return names;
}

function reportCallProblems(ctx) {
  const problems = [];
  const { code, mask } = ctx;
  const pageName = pageNameDeclared(ctx);
  const builtInHelpers = new Set();
  for (const call of dataCalls(ctx)) if (call.builtIn && call.fn) builtInHelpers.add(call.fn);
  const boundary = boundaryClass(ctx);
  ctx.returnedViews = [];
  for (const site of ctx.reportSites) {
    const label = `${REPORTER} at line ${lineOf(code, site.at)}`;
    const count = site.args.length;
    if (count < 5) { problems.push(`${label}: needs five arguments (page name, operation, code, message, kind); found ${count}`); continue; }
    if (count > 7) problems.push(`${label}: takes at most seven arguments; found ${count}`);
    const kind = literalString(site.text(4));
    if (!KINDS.has(kind)) problems.push(`${label}: the fifth argument (kind) must be a literal 'read', 'write', 'indeterminate', 'network' or 'render'`);
    const page = site.text(0).trim();
    if (!((page === 'PAGE_NAME' && pageName) || literalString(page) !== null)) problems.push(`${label}: the page name must be the PAGE_NAME literal`);
    if (literalString(site.text(1)) === null) problems.push(`${label}: the operation must be one stable string literal`);
    const errorField = (field) => new RegExp(`^${IDENT}\\s*\\.\\s*error\\s*(?:\\?\\.|\\.)\\s*${field}$`);
    const codeArg = site.text(2).trim();
    if (!(codeArg === 'undefined' || errorField('code').test(codeArg) || literalString(codeArg) !== null)) {
      problems.push(`${label}: the code must be undefined, a result's error.code or a literal — never derived from data`);
    }
    const messageArg = site.text(3).trim();
    const caught = caughtNames(ctx, site.at);
    if (!(messageArg === 'undefined' || errorField('message').test(messageArg) || caught.has(messageArg)
      || new RegExp(`^${IDENT}\\s*\\.\\s*reason$`).test(messageArg) || literalString(messageArg) !== null
      || /^new\s+Error\s*\(\s*(['"])[^'"]*\1\s*\)$/.test(messageArg))) {
      problems.push(`${label}: the message must be the caught error, a result's error.message, an allSettled reason or a fixed text — never a result, row or state`);
    }
    const retry = count > 5 ? site.text(5).trim() : 'undefined';
    if (retry !== 'undefined') {
      if (kind && !['read', 'network'].includes(kind)) problems.push(`${label}: a ${kind} failure never offers a retry`);
      if (!new RegExp(`^${IDENT}$`).test(retry) || !declaredFunction(ctx, retry)) problems.push(`${label}: the retry must be a named function, passed — not called or built inline`);
    }
    const telemetry = count > 6 ? site.text(6).trim() : 'undefined';
    if (telemetry !== 'undefined' && !CHAIN.test(squash(telemetry))) problems.push(`${label}: the telemetry argument must be the page's appInsights prop`);
    const fn = innermostFunction(ctx, site.at);
    const helper = fn && ctx.named.find((entry) => entry.body.start === fn.start && entry.body.end === fn.end);
    if (helper && builtInHelpers.has(helper.name) && (kind !== 'read' || retry !== 'undefined')) {
      problems.push(`${label}: a built-in operation failure is a read with no retry`);
    }
    // componentDidCatch is the one report whose view is intentionally discarded: the boundary renders its own copy.
    if (boundary && site.at > boundary.didCatch.start && site.at < boundary.didCatch.end) continue;
    const followed = followView(ctx, site.at, site.close + 1, label);
    problems.push(...followed.problems);
    for (const where of followed.returned) ctx.returnedViews.push({ ...where, helper });
  }
  return problems;
}

function declaredFunction(ctx, name) {
  return ctx.named.some((fn) => fn.name === name);
}
const lineOf = (code, at) => code.slice(0, at).split('\n').length;

// `const PAGE_NAME = '<display name>';` once, at the top level, never assigned again: the fixed page name every
// report logs.
function pageNameDeclared(ctx) {
  const decl = /^const\s+PAGE_NAME\s*(?::\s*string\s*)?=\s*([^;\n]+?)\s*;?\s*$/m.exec(ctx.code);
  return Boolean(decl && depthAt(ctx.mask, decl.index) === 0 && literalString(decl[1])
    && (ctx.mask.match(/\bPAGE_NAME\s*=(?!=)/g) || []).length === 1);
}

// Family 2: a named helper that returns `{ error: view }` — every caller awaits it and stores the error it returns.
function returnedViewProblems(ctx) {
  const problems = [];
  const helpers = new Map();
  for (const where of ctx.returnedViews || []) {
    if (!where.helper) { problems.push('a reported view is returned from an unnamed function, so its caller cannot be followed (unverifiable)'); continue; }
    helpers.set(where.helper.name, where.helper);
  }
  for (const [name] of helpers) problems.push(...helperConsumerProblems(ctx, name));
  return problems;
}

function helperConsumerProblems(ctx, name) {
  const problems = [];
  const { mask } = ctx;
  const sites = callSites(mask, name);
  if (!sites.length) return [`${name} returns an error view but nothing calls it`];
  for (const mention of mask.matchAll(new RegExp(`(?<![\\w$.])${escapeRe(name)}(?![\\w$])`, 'g'))) {
    const tail = mask.slice(mention.index + name.length);
    if (/^\s*\(/.test(tail) || /\bfunction\s*$/.test(mask.slice(Math.max(0, mention.index - 12), mention.index))
      || /\b(?:const|let|var)\s*$/.test(mask.slice(Math.max(0, mention.index - 12), mention.index))) continue;
    problems.push(`${name} returns an error view but is handed on as a value, so its caller cannot be followed (unverifiable)`);
    break;
  }
  for (const site of sites) {
    const label = `${name}(…) at line ${lineOf(ctx.code, site.at)}`;
    const head = mask.slice(0, site.at);
    let binding = null;
    let scopeEnd = blockEnd(mask, site.at);
    const awaited = new RegExp(`\\b(?:const|let)\\s+(${IDENT})\\s*(?::[^=;]+)?=\\s*await\\s+$`).exec(head);
    if (awaited) binding = { name: awaited[1], at: site.at, path: [] };
    else {
      const grouped = groupedBinding(ctx, site.at, 'all');
      if (grouped) {
        binding = { name: grouped.name, at: site.at, path: [] };
        scopeEnd = blockEnd(mask, grouped.declAt);
      }
    }
    if (!binding) { problems.push(`${label}: the returned error view is not awaited into a variable, so it is not stored (discarded)`); continue; }
    const stored = storedResult(ctx, binding, scopeEnd);
    if (!stored.length) problems.push(`${label}: the error it returns never reaches state a PageErrorBar renders`);
    for (const where of stored) {
      if (!rendered(ctx, where.setter, where.path)) problems.push(`${label}: the error view stored by ${where.setter} is never rendered by a <PageErrorBar error={…} />`);
    }
  }
  return problems;
}

// Where a helper's result `r` is stored: `setX(r)` (its error is r.error), `setX({ k: r })`, `setX(r.error)`,
// `setX({ k: r.error ?? other.error ?? null })`. Returns setter destinations with the path of the error.
function storedResult(ctx, binding, scopeEnd) {
  const { mask } = ctx;
  const out = [];
  const re = new RegExp(`(?<![\\w$.])${escapeRe(binding.name)}(?![\\w$])`, 'g');
  for (const use of mask.slice(0, scopeEnd).matchAll(re)) {
    if (use.index <= binding.at) continue;
    const tail = mask.slice(use.index + binding.name.length);
    const member = /^\s*\.\s*error\b/.exec(tail);
    if (!member && /^\s*\.\s*\w/.test(tail)) continue; // `r.rows` and friends are data, not the error
    let start = use.index;
    let end = use.index + binding.name.length + (member ? member[0].length : 0);
    const suffix = member ? [] : ['error'];
    if (member) {
      // `a.error ?? b.error ?? null` stores whichever error comes first: follow the whole coalescing expression,
      // from its first operand to its last.
      for (let back; (back = new RegExp(`(?<![\\w$.])${IDENT}\\s*\\.\\s*error\\s*\\?\\?\\s*$`).exec(mask.slice(0, start)));) start = back.index;
      const coalesced = new RegExp(`^(?:\\s*\\?\\?\\s*(?:${IDENT}\\s*\\.\\s*error|null|undefined))+`).exec(mask.slice(end));
      if (coalesced) end += coalesced[0].length;
    }
    const where = destination(ctx, start, end, suffix);
    if (where.kind === 'setter') out.push(where);
  }
  return out;
}

// The name `site` is destructured into from `const [a, b] = await Promise.<all|allSettled>([…])`, by its position, and
// where that declaration starts.
function groupedBinding(ctx, at, kind) {
  const { mask } = ctx;
  const method = kind === 'all' ? 'all' : 'allSettled';
  for (const match of mask.matchAll(new RegExp(`\\b(?:const|let)\\s*\\[([^\\]]*)\\]\\s*=\\s*await\\s+Promise\\s*\\.\\s*${method}\\s*\\(\\s*\\[`, 'g'))) {
    const open = match.index + match[0].length - 1;
    const close = groupEnd(mask, open);
    if (!(open < at && at < close)) continue;
    const elements = argRangesOfArray(mask, open);
    const index = elements.findIndex(([a, b]) => a <= at && at < b);
    const names = match[1].split(',').map((part) => part.trim());
    if (index < 0 || names.length !== elements.length || !new RegExp(`^${IDENT}$`).test(names[index] || '')) return null;
    return { name: names[index], declAt: match.index };
  }
  return null;
}
function argRangesOfArray(mask, open) {
  const close = groupEnd(mask, open);
  const ranges = [];
  let start = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    if ('({['.includes(mask[i])) { i = groupEnd(mask, i); continue; }
    if (mask[i] === ',') { ranges.push(trimRange(mask, start, i)); start = i + 1; }
  }
  if (mask.slice(start, close).trim()) ranges.push(trimRange(mask, start, close));
  return ranges;
}

// ---------- data calls ----------

const CALL_RE = new RegExp(`\\.\\s*(${LISTED_METHODS.join('|')})\\s*(?:\\?\\.\\s*)?(?:!\\s*)?(?:<(?:[^<>()]|<[^<>()]*>)*>\\s*)?\\(`, 'g');

function dataCalls(ctx) {
  if (ctx.calls) return ctx.calls;
  const { code, mask } = ctx;
  ctx.calls = [];
  for (const match of mask.matchAll(CALL_RE)) {
    const open = match.index + match[0].length - 1;
    const chain = new RegExp(`(${IDENT}(?:\\s*\\??\\.\\s*${IDENT})*)\\s*\\??\\s*$`).exec(mask.slice(0, match.index));
    const receiver = chain ? chain[1].replace(/\s+/g, '').replace(/\?\./g, '.') : null;
    const receiverAt = chain ? match.index - chain[0].length : match.index;
    const fn = innermostFunction(ctx, match.index);
    const helper = fn && ctx.named.find((entry) => entry.body.start === fn.start && entry.body.end === fn.end);
    let builtIn = false;
    if (match[1] === 'executeFunction') {
      const args = argRanges(mask, open).args;
      const request = args[0] ? code.slice(args[0][0], args[0][1]) : '';
      const name = /^\{\s*name\s*:\s*(['"])(\w+)\1\s*,?\s*\}$/.exec(request.trim());
      builtIn = Boolean(name && BUILT_INS.has(name[2]));
    }
    ctx.calls.push({ method: match[1], at: match.index, open, close: groupEnd(mask, open), receiver, receiverAt, fn: helper ? helper.name : null, builtIn });
  }
  return ctx.calls;
}

// A receiver bound to a local object, array, `new` instance or literal in this page: not the page DataAPI, out of scope.
function unrelatedLocal(ctx, receiver) {
  const root = receiver.split('.')[0];
  return new RegExp(`\\b(?:const|let|var)\\s+${escapeRe(root)}\\s*(?::[^=;]+)?=\\s*(?:\\{|\\[|new\\b|['"\`\\d])`).test(ctx.mask);
}

function dataCallProblems(ctx) {
  const problems = [];
  const { mask } = ctx;
  for (const stray of mask.matchAll(/\.\s*retrieveMultipleRecords\s*\(/g)) {
    problems.push(`retrieveMultipleRecords at line ${lineOf(ctx.code, stray.index)} is not a page DataAPI method (unverifiable)`);
  }
  for (const call of dataCalls(ctx)) {
    const label = `${call.method} at line ${lineOf(ctx.code, call.at)}`;
    if (!call.receiver) { problems.push(`${label}: called on an expression whose provenance cannot be read (unverifiable)`); continue; }
    if (!receiverIsDataApi(mask, ctx.scopes, call.receiver, call.at)) {
      if (unrelatedLocal(ctx, call.receiver)) continue;
      problems.push(`${label}: ${call.receiver} is not provably the page dataApi (unverifiable)`);
      continue;
    }
    const before = mask.slice(0, call.receiverAt);
    if (/\bawait\s*$/.test(before)) { problems.push(...awaitedProblems(ctx, call, label)); continue; }
    if (/\bPromise\s*\.\s*all\s*\(\s*\[[^\]]*$/.test(before)) { problems.push(`${label}: a data call straight inside Promise.all is unsupported — one rejection hides the others; wrap each read in a named helper that reports and returns { error }`); continue; }
    if (groupedBinding(ctx, call.at, 'allSettled')) { problems.push(...settledProblems(ctx, call, label)); continue; }
    const cache = cacheProblems(ctx, call, label);
    if (cache) { problems.push(...cache); continue; }
    problems.push(`${label}: not awaited in a try, held by a canonical cached promise, or a checked allSettled item (unverifiable)`);
  }
  return problems;
}

// Which accepted shape each listed data call of a page takes — 'awaited' (families 1 and 4, a returned view included),
// 'cache' (family 3), 'settled' (family 5b), or 'unrelated' (a local object, out of scope) — read the way
// dataCallProblems reads them, so a scenario can require the shapes it is meant to exercise as well as their success:
// a page that passes because it never makes the call proves nothing about it. A call no shape takes is 'unverifiable'.
// [{ method, family, builtIn }] in source order; [] when the page is not gradeable.
function dataCallFamilies(content) {
  let ctx;
  try { ctx = context(String(content ?? '')); } catch { return []; }
  return dataCalls(ctx).map((call) => {
    const shape = (family) => ({ method: call.method, family, builtIn: call.builtIn });
    if (!call.receiver) return shape('unverifiable');
    if (!receiverIsDataApi(ctx.mask, ctx.scopes, call.receiver, call.at)) return shape(unrelatedLocal(ctx, call.receiver) ? 'unrelated' : 'unverifiable');
    const before = ctx.mask.slice(0, call.receiverAt);
    if (/\bawait\s*$/.test(before)) return shape(awaitedProblems(ctx, call, call.method).length ? 'unverifiable' : 'awaited');
    if (groupedBinding(ctx, call.at, 'allSettled')) return shape(settledProblems(ctx, call, call.method).length ? 'unverifiable' : 'settled');
    const cache = cacheProblems(ctx, call, call.method);
    return shape(cache && !cache.length ? 'cache' : 'unverifiable');
  });
}

// Family 1/2/4: an awaited call in a try of its own function, a catch that reports, and the result guards.
function awaitedProblems(ctx, call, label) {
  const problems = [];
  // `await dataApi.createRow(…).catch(() => undefined)`: whatever follows the request decides what is awaited, and a
  // `.catch`, a two-argument `.then` or any other link can consume the rejection before the catch ever sees it.
  if (/^\s*(?:\?\.|\.|\[)/.test(ctx.mask.slice(call.close + 1))) {
    return [`${label}: the awaited request is chained (\`.catch\`, \`.then\`, …), so its rejection may never reach the catch (unverifiable)`];
  }
  const tries = enclosingTries(ctx, call.at);
  const guarded = tries.map((entry) => ({ ...entry, handler: catchAfter(ctx, entry.close) })).find((entry) => entry.handler);
  if (!guarded) return [`${label}: awaited outside a try with a catch in its own function`];
  problems.push(...catchProblems(ctx, guarded.handler, label));
  problems.push(...envelopeProblems(ctx, call, guarded, label));
  return problems;
}

// A catch body reports on its live path: only staleness guards may return first, and a report kept under an `if` sits
// under the fresh condition.
function catchProblems(ctx, handler, label) {
  const body = { open: handler.open, start: handler.open + 1, end: handler.close };
  return liveReportProblems(ctx, body, label, 'catch');
}

// ---------- where a report runs ----------
// A report proves something only if it runs whenever its failure does. It must be a statement of the failure path's own
// body — the catch, a guard's block or a `.catch` handler — or the consequent of an `if (<fresh condition>)` written there;
// the statement starts at the report's destination (the setter, the declaration of the view, `return`). A report inside a
// function the body only defines, inside an expression (`false && …`, `c ? … : …`, a comma, `void`), in another block (an
// inner `if`, a loop, `else`) or after a return that is not a staleness guard is not on that path.

// The innermost `{` around `at` that opens a statement block, or null when `at` sits in parentheses or brackets first.
function enclosingBlock(mask, at) {
  let depth = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    const ch = mask[i];
    if (')}]'.includes(ch)) depth += 1;
    else if ('({['.includes(ch)) {
      if (depth > 0) { depth -= 1; continue; }
      return ch === '{' ? i : null;
    }
  }
  return null;
}
// The `(` matching the `)` at `close`.
function matchingOpen(mask, close) {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    if (mask[i] === ')') depth += 1;
    else if (mask[i] === '(' && --depth === 0) return i;
  }
  return -1;
}
// The `if (…)` whose `)` is at `close`: { ifAt, open, close }, or null (a call, a loop header, an `else if`).
function ifHead(mask, close) {
  if (mask[close] !== ')') return null;
  const open = matchingOpen(mask, close);
  if (open < 0) return null;
  const keyword = /\bif\s*$/.exec(mask.slice(0, open));
  if (!keyword || /\belse\s*$/.test(mask.slice(0, keyword.index))) return null;
  return { ifAt: keyword.index, open, close };
}
const previousToken = (mask, at) => { let i = at - 1; while (i >= 0 && /\s/.test(mask[i])) i -= 1; return i; };
// Where the statement starting at `anchor` runs in `body` ({ open, start, end } of a block, or { start, end, expression }
// of an arrow's expression body): 'top', { guard: [open, close] } for the consequent of an if at the top, or null.
function placement(ctx, anchor, body) {
  const { mask } = ctx;
  if (body.expression) return anchor === body.start ? 'top' : null;
  const atTop = (at) => enclosingBlock(mask, at) === body.open;
  const prev = previousToken(mask, anchor);
  if (prev >= 0 && ';{}'.includes(mask[prev])) {
    if (atTop(anchor)) return 'top';
    const block = enclosingBlock(mask, anchor);
    const head = block === null ? null : ifHead(mask, previousToken(mask, block));
    return head && atTop(head.ifAt) ? { guard: [head.open, head.close], ifAt: head.ifAt } : null;
  }
  const head = ifHead(mask, prev);
  return head && atTop(head.ifAt) ? { guard: [head.open, head.close], ifAt: head.ifAt } : null;
}

// The first report that runs on the body's own path: { site, anchor, place } or { reason }.
function liveReport(ctx, body) {
  const own = innermostFunction(ctx, body.start + 1);
  let reason = 'does not report through reportPageError';
  for (const site of ctx.reportSites.filter((entry) => entry.at >= body.start && entry.at < body.end)) {
    if (innermostFunction(ctx, site.at) !== own) { reason = 'reports only inside a function it defines and never runs on its path'; continue; }
    const anchor = destination(ctx, site.at, site.close + 1).anchor;
    const place = anchor === undefined ? null : placement(ctx, anchor, body);
    if (!place) { reason = 'reports only inside an expression or another block that may not run — make the report a statement of its own'; continue; }
    if (place.guard && !freshCondition(ctx, ctx.code.slice(place.guard[0] + 1, place.guard[1]))) { reason = 'reports only under a condition that is not a staleness guard'; continue; }
    return { site, anchor, place };
  }
  return { reason };
}

function liveReportProblems(ctx, body, label, where) {
  const { mask, code } = ctx;
  const found = liveReport(ctx, body);
  if (!found.site) return [`${label}: its ${where} ${found.reason}`];
  const problems = [];
  // Before the report's statement runs, only an `if (<stale condition>) return;` may leave the body.
  const until = found.place.guard ? found.place.ifAt : found.anchor;
  let text = mask.slice(body.start, until);
  for (const guard of text.matchAll(/\bif\s*\(/g)) {
    const open = body.start + guard.index + guard[0].length - 1;
    const close = groupEnd(mask, open);
    const consequent = /^\s*(?:return\s*;?|\{\s*return\s*;?\s*\})/.exec(mask.slice(close + 1));
    if (consequent && !staleCondition(ctx, code.slice(open + 1, close))) problems.push(`${label}: its ${where} returns before the report on a condition that is not a staleness guard`);
  }
  text = text.replace(/\bif\s*\([^)]*\)\s*(?:return\s*;?|\{\s*return\s*;?\s*\})/g, '');
  if (/\breturn\b|\bthrow\b/.test(text)) problems.push(`${label}: its ${where} can return before the report`);
  return problems;
}
// Family 4: the guards a returned result needs before its outputs or body are read.
function envelopeProblems(ctx, call, guarded, label) {
  const { mask, code } = ctx;
  const envelope = ['executeAction', 'executeFunction', 'executeConnectorOperation'].includes(call.method);
  if (!envelope) return [];
  const kept = new RegExp(`\\b(?:const|let)\\s+(${IDENT})\\s*(?::[^=;]+)?=\\s*await\\s+$`).exec(mask.slice(0, call.receiverAt));
  if (!kept) return [`${label}: its result is not kept, so its failure guard cannot be checked`];
  const res = kept[1];
  const region = { start: call.close + 1, end: guarded.close };
  const guards = [];
  for (const match of mask.slice(region.start, region.end).matchAll(/\bif\s*\(/g)) {
    const open = region.start + match.index + match[0].length - 1;
    const close = groupEnd(mask, open);
    const condition = squash(code.slice(open + 1, close)).replace(/'/g, '\'');
    let then = close + 1;
    while (/\s/.test(mask[then])) then += 1;
    if (mask[then] !== '{') { guards.push({ at: open, condition, flat: false }); continue; }
    const end = groupEnd(mask, then);
    guards.push({ at: open, condition, block: { start: then + 1, end }, flat: true });
  }
  const find = (conditions) => guards.find((guard) => conditions.includes(guard.condition));
  const read = (field) => mask.slice(region.start, region.end).search(new RegExp(`\\b${escapeRe(res)}\\s*(?:\\?\\.|\\.)\\s*${field}\\b`));
  const flagIndeterminate = find([`${res}.indeterminate`]);
  const codeIndeterminate = find([`${res}.error.code==='indeterminate'`]);
  const network = find([`!${res}.ok&&${res}.error.code==='network'`]);
  const notOk = find([`!${res}.ok`, `${res}.ok===false`, `${res}.ok!==true`]);
  const problems = [];
  const reports = (guard, kinds, what) => {
    if (!guard.flat) { problems.push(`${label}: the ${what} guard must be a block that reports and returns`); return; }
    // The guard's block is that failure's path: its report must run there, as a statement of the block.
    const found = liveReport(ctx, { open: guard.block.start - 1, start: guard.block.start, end: guard.block.end });
    if (!found.site) { problems.push(`${label}: the ${what} guard ${found.reason}`); return; }
    const { site } = found;
    const kind = literalString(site.text(4) || '');
    if (!kinds.includes(kind)) problems.push(`${label}: the ${what} guard must report kind ${kinds.map((entry) => `'${entry}'`).join(' or ')}`);
    if (!/\breturn\b/.test(mask.slice(site.close, guard.block.end))) problems.push(`${label}: the ${what} guard must return after it reports`);
  };
  if (call.method === 'executeConnectorOperation') {
    if (!notOk) return [`${label}: the connector response is not checked with \`if (!${res}.ok)\` before its body is read`];
    reports(notOk, ['read', 'write'], 'response.ok');
    const body = read('body');
    if (body >= 0 && region.start + body < notOk.at) problems.push(`${label}: ${res}.body is read before ${res}.ok is checked`);
    return problems;
  }
  if (call.builtIn) {
    if (!notOk) return [`${label}: a built-in result is not checked with \`if (${res}.ok !== true)\` before its outputs are read`];
    reports(notOk, ['read'], 'built-in failure');
    if (network) problems.push(`${label}: a built-in operation has no network retry — its failure is a read`);
    return problems;
  }
  if (!flagIndeterminate) problems.push(`${label}: \`if (${res}.indeterminate)\` must report an indeterminate result first`);
  else reports(flagIndeterminate, ['indeterminate'], `${res}.indeterminate`);
  if (!codeIndeterminate) problems.push(`${label}: \`if (${res}.error?.code === 'indeterminate')\` must report a code-only indeterminate result`);
  else reports(codeIndeterminate, ['indeterminate'], 'indeterminate code');
  if (!notOk) problems.push(`${label}: \`if (!${res}.ok)\` must report a failed result before its outputs are read`);
  else reports(notOk, ['read', 'write'], `${res}.ok`);
  if (network) {
    reports(network, ['network'], 'network');
    for (const [guard, what] of [[flagIndeterminate, `${res}.indeterminate`], [codeIndeterminate, 'the indeterminate code']]) {
      if (guard && guard.at > network.at) problems.push(`${label}: ${what} must be checked before the network guard`);
    }
    if (notOk && notOk.at < network.at) problems.push(`${label}: the network guard must come before the generic \`!${res}.ok\` guard`);
  }
  for (const [guard, what] of [[flagIndeterminate, `${res}.indeterminate`], [codeIndeterminate, 'the indeterminate code']]) {
    if (guard && notOk && guard.at > notOk.at) problems.push(`${label}: ${what} must be checked before \`!${res}.ok\``);
  }
  const outputs = read('outputs');
  for (const guard of [flagIndeterminate, codeIndeterminate, notOk]) {
    if (guard && outputs >= 0 && region.start + outputs < guard.at) problems.push(`${label}: ${res}.outputs is read before every failure guard`);
  }
  return [...new Set(problems)];
}

// Family 5b: a fixed allSettled tuple whose every item is checked for rejection and reported.
function settledProblems(ctx, call, label) {
  const { mask } = ctx;
  const { name: item, declAt } = groupedBinding(ctx, call.at, 'allSettled');
  const scopeEnd = blockEnd(mask, declAt);
  // The status literal is blanked in the mask, so the branch is read from the source, at code positions only.
  const branch = codeMatches(ctx, new RegExp(`\\bif\\s*\\(\\s*${escapeRe(item)}\\s*\\.\\s*status\\s*===\\s*(['"])rejected\\1\\s*\\)`, 'g'), declAt, scopeEnd)[0];
  if (!branch) return [`${label}: the allSettled item ${item} is never checked for 'rejected' and reported`];
  // The report is the branch's own statement: right after `if (… === 'rejected')`, or the first statement of its block.
  const closeParen = branch.index + branch[0].length - 1;
  const reported = ctx.reportSites.some((site) => {
    if (!(site.at > branch.index && site.at < scopeEnd) || squash(site.text(3) || '') !== `${item}.reason`) return false;
    const anchor = destination(ctx, site.at, site.close + 1).anchor;
    if (anchor === undefined) return false;
    const prev = previousToken(mask, anchor);
    return prev === closeParen || (mask[prev] === '{' && previousToken(mask, prev) === closeParen && enclosingBlock(mask, anchor) === prev);
  });
  if (!reported) return [`${label}: the rejected branch of ${item} does not report ${item}.reason`];
  return [];
}

// Matches of `re` (global) in the source between `from` and `to` that start in code — not in a comment or a string.
function codeMatches(ctx, re, from, to) {
  return [...ctx.code.slice(0, to).matchAll(re)].filter((match) => match.index >= from && ctx.mask[match.index] === ctx.code[match.index]);
}

// Family 3: the canonical cached promise. Returns null when the call is not a cache producer at all.
function cacheProblems(ctx, call, label) {
  const { mask, code } = ctx;
  const head = mask.slice(0, call.receiverAt);
  const declared = new RegExp(`\\b(?:const|let)\\s+(${IDENT})\\s*(?::[^=;]+)?=\\s*$`).exec(head);
  const assigned = !declared && new RegExp(`(?<![\\w$.])(${IDENT})\\s*=\\s*$`).exec(head);
  if (!declared && !assigned) return null;
  const binding = (declared || assigned)[1];
  const fn = innermostFunction(ctx, call.at);
  const scope = fn ? { start: fn.start, end: fn.end } : { start: 0, end: mask.length };
  const problems = [];
  // The producer: the call, then only `.then(…)` / `.finally(…)`, up to the end of its statement.
  let i = call.close + 1;
  for (;;) {
    const link = /^\s*\.\s*(then|finally|catch)\s*\(/.exec(mask.slice(i));
    if (!link) break;
    if (link[1] === 'catch') problems.push(`${label}: the producer chain catches its own rejection, so a failure could be cached as data`);
    i = groupEnd(mask, i + link[0].length - 1) + 1;
  }
  const writes = [...mask.slice(scope.start, scope.end).matchAll(new RegExp(`(?<![\\w$.])${escapeRe(binding)}\\s*=(?![=>])`, 'g'))]
    .map((match) => scope.start + match.index)
    .filter((at) => !/\b(?:const|let|var)\s+$/.test(mask.slice(Math.max(0, at - 12), at)));
  if (assigned) {
    const decl = new RegExp(`\\blet\\s+${escapeRe(binding)}\\s*(?::[^=;]+)?=\\s*([^;]+);`).exec(mask.slice(scope.start, call.at));
    const slot = decl && /^\s*(?:[\w$]+\s*\[[^\]]*\]|[\w$]+\s*\.\s*__[\w$]+|[\w$]+\s*\.\s*get\s*\([^)]*\))\s*(?:as\b[\s\S]*)?$/.test(decl[1]);
    if (!slot) problems.push(`${label}: the cached promise ${binding} must start as a read of its window or Map in-flight slot`);
    const guard = new RegExp(`\\bif\\s*\\(\\s*!\\s*${escapeRe(binding)}\\s*\\)\\s*\\{`).exec(mask.slice(scope.start, call.at));
    const guardOpen = guard ? scope.start + guard.index + guard[0].length - 1 : -1;
    const guardClose = guard ? groupEnd(mask, guardOpen) : -1;
    if (!guard || !(guardOpen < call.at && call.at < guardClose)) problems.push(`${label}: the producer is assigned outside its \`if (!${binding})\` guard`);
    else if (!new RegExp(`(?:\\]\\s*=\\s*${escapeRe(binding)}\\b|\\.\\s*__[\\w$]+\\s*=\\s*${escapeRe(binding)}\\b|\\.\\s*set\\s*\\([^,]+,\\s*${escapeRe(binding)}\\s*\\))`).test(mask.slice(i, guardClose))) {
      problems.push(`${label}: the guarded producer does not store ${binding} in its in-flight slot`);
    }
    if (writes.length !== 1) problems.push(`${label}: ${binding} is assigned more than once, so another promise could stand in for this read`);
  } else if (writes.length) problems.push(`${label}: ${binding} is assigned again after its declaration`);
  // The consumer: `<binding>.then(…).catch(handler)` on the SAME binding, after the producer, in the same function.
  const consumer = new RegExp(`(?<![\\w$.])${escapeRe(binding)}\\s*\\.\\s*then\\s*\\(`, 'g');
  consumer.lastIndex = i;
  const found = consumer.exec(mask.slice(0, scope.end));
  if (!found) { problems.push(`${label}: no \`${binding}.then(…).catch(…)\` consumer on the same binding reports a rejection`); return problems; }
  let j = groupEnd(mask, found.index + found[0].length - 1) + 1;
  let handler = null;
  for (;;) {
    const link = /^\s*\.\s*(then|catch|finally)\s*\(/.exec(mask.slice(j));
    if (!link) break;
    const open = j + link[0].length - 1;
    if (link[1] === 'catch') handler = { open, close: groupEnd(mask, open) };
    j = groupEnd(mask, open) + 1;
  }
  if (!handler) { problems.push(`${label}: the consumer of ${binding} has no .catch(…) that reports`); return problems; }
  const arrow = new RegExp(`^\\s*(?:\\(\\s*(?:${IDENT})?\\s*(?::[^)]*)?\\)|${IDENT})\\s*=>\\s*`).exec(mask.slice(handler.open + 1));
  if (!arrow) { problems.push(`${label}: the .catch of ${binding} must be an arrow function that reports`); return problems; }
  const bodyStart = handler.open + 1 + arrow[0].length;
  const body = mask[bodyStart] === '{' ? { open: bodyStart, start: bodyStart + 1, end: groupEnd(mask, bodyStart) } : { start: bodyStart, end: handler.close, expression: true };
  problems.push(...liveReportProblems(ctx, body, label, `.catch of ${binding}`));
  const handlerText = mask.slice(body.start, body.end);
  if (/\]\s*=(?![=>])|\.\s*__[\w$]+\s*=(?![=>])|\.\s*set\s*\(/.test(handlerText)) problems.push(`${label}: the .catch of ${binding} writes the cache — a rejection is never cached as data`);
  return problems;
}

// ---------- boundary and UI ----------

// The module-level `class PageErrorBoundary extends (React.)Component<…> { … }` and its componentDidCatch range.
function boundaryClass(ctx) {
  const { mask } = ctx;
  const match = /\bclass\s+PageErrorBoundary\s+extends\s+(?:React\s*\.\s*)?Component\s*</.exec(mask);
  if (!match || depthAt(mask, match.index) !== 0) return null;
  const open = mask.indexOf('{', match.index + match[0].length + mask.slice(match.index + match[0].length).search(/>\s*\{/));
  if (open < 0) return null;
  const close = groupEnd(mask, open);
  const didCatch = /\bcomponentDidCatch\s*\(/.exec(mask.slice(open, close));
  if (!didCatch) return { open, close, didCatch: { start: -1, end: -1 } };
  const bodyOpen = mask.indexOf('{', open + didCatch.index);
  return { open, close, didCatch: { start: bodyOpen, end: groupEnd(mask, bodyOpen) } };
}

function boundaryProblems(ctx) {
  const problems = [];
  const { code, mask } = ctx;
  if (!forwardedPageBodyOf(code)) problems.push('the default export does not mount PageErrorBoundary around PageBody — `const GeneratedComponent = (props) => (<PageErrorBoundary><PageBody {...props} /></PageErrorBoundary>)`');
  const classes = mask.match(/\bclass\s+PageErrorBoundary\b/g) || [];
  const boundary = boundaryClass(ctx);
  if (!boundary || classes.length !== 1) return [...problems, 'no single top-level class PageErrorBoundary extends React.Component'];
  const body = squash(code.slice(boundary.open, boundary.close + 1)).replace(/\bpublic|\bprivate|\breadonly/g, '');
  const param = /componentDidCatch\((\w+)/.exec(body);
  const didCatch = param && [
    `componentDidCatch(${param[1]}:Error):void{reportPageError(PAGE_NAME,'render',undefined,${param[1]},'render');}`,
    `componentDidCatch(${param[1]}:Error):void{reportPageError(PAGE_NAME,'render',undefined,${param[1]},'render',undefined,this.props.appInsights);}`,
    `componentDidCatch(${param[1]}){reportPageError(PAGE_NAME,'render',undefined,${param[1]},'render');}`,
  ].some((form) => body.includes(form));
  if (!didCatch) problems.push('PageErrorBoundary.componentDidCatch must report the crash as reportPageError(PAGE_NAME, \'render\', undefined, error, \'render\')');
  if (!/staticgetDerivedStateFromError\(\)(?::\{failed:boolean\})?\{return\{failed:true\};?\}/.test(body)) problems.push('PageErrorBoundary.getDerivedStateFromError must return { failed: true }');
  if (!/state(?::\{failed:boolean\})?=\{failed:false\};/.test(body) || (body.match(/failed:false/g) || []).length !== 1) problems.push('PageErrorBoundary starts { failed: false } and never resets');
  if (/setState\(|componentDidUpdate|forceUpdate/.test(body)) problems.push('PageErrorBoundary has a reset (setState): a crashing tree is never re-rendered');
  if (!/render\(\)(?::React\.ReactNode|:ReactNode)?\{if\(this\.state\.failed\)\{return\(?<MessageBarintent='error'><MessageBarBody>\{translate\('error\.render'\)\}<\/MessageBarBody><\/MessageBar>\)?;?\}returnthis\.props\.children;\}/.test(body)) {
    problems.push('PageErrorBoundary.render must show the localized error.render copy in a MessageBar when failed, and its children otherwise');
  }
  if (!new RegExp(`^(?:function\\s+translate\\s*\\(|const\\s+translate\\s*=)`, 'm').test(code)) problems.push('no top-level translate() for the error copy');
  if (ctx.reportSites.length && !pageNameDeclared(ctx)) problems.push('no single top-level PAGE_NAME string literal');
  if (ctx.barElements.length) {
    // The bar is copied unchanged, like the reporter: a bar that returns early, hides the message or CALLS the retry
    // while rendering (`onClick={error.retry()}` sends a request with no click) proves nothing about what is shown.
    const bar = topLevelFunction(code, mask, 'PageErrorBar');
    const lines = bar ? canonicalLines(code.slice(bar.start, bar.end)).join('\n') : '';
    const declarations = mask.match(/\b(?:function|class|const|let|var)\s+PageErrorBar(?![\w$])/g) || [];
    if (!bar || declarations.length !== 1 || !canonicalBars().includes(lines) || /(?<![\w$.])PageErrorBar\s*=(?![=>])/.test(mask)) {
      problems.push('PageErrorBar must be the canonical top-level bar of references/rules.md, copied unchanged (a page that never offers a retry may leave out its retry part): nothing without an error, else a MessageBar showing error.message or its translated fallback, and the retry passed to its button, never called');
    }
  }
  return problems;
}

// ---------- entry points ----------

// The problems of one page's source; [] when it satisfies the contract.
function pageErrorProblems(content) {
  const code = String(content ?? '');
  let ctx;
  try { ctx = context(code); } catch (error) { return [`the page is not gradeable (${error.message})`]; }
  const problems = [];
  try {
    problems.push(...reporterProblems(ctx));
    problems.push(...boundaryProblems(ctx));
    problems.push(...reportCallProblems(ctx));
    problems.push(...returnedViewProblems(ctx));
    problems.push(...dataCallProblems(ctx));
  } catch (error) {
    problems.push(`the page is not gradeable (${error.message})`);
  }
  return [...new Set(problems)];
}

// The [start, end) source ranges of the seventh (telemetry) argument of every canonical read report on an unmodified
// result's error.code/error.message, or on a caught error, with no retry — the one place an authorized built-in failure
// may name appInsights (action-binding-union.js keeps every other mention fail-closed). [] when the reporter is not the
// canonical one.
function telemetrySafeSpans(content) {
  const code = String(content ?? '');
  let ctx;
  try { ctx = context(code); } catch { return []; }
  const range = topLevelFunction(code, ctx.mask, REPORTER);
  if (!range) return [];
  const { base, telemetry } = canonicalReporter();
  const lines = canonicalLines(code.slice(range.start, range.end)).join('\n');
  if (lines !== base && lines !== telemetry) return [];
  const spans = [];
  for (const site of ctx.reportSites) {
    if (site.args.length !== 7) continue;
    if (site.text(0).trim() !== 'PAGE_NAME' || literalString(site.text(1)) === null || literalString(site.text(4)) !== 'read') continue;
    if (site.text(5).trim() !== 'undefined' || !CHAIN.test(squash(site.text(6)))) continue;
    const codeArg = squash(site.text(2));
    const messageArg = squash(site.text(3));
    const result = /^([A-Za-z_$][\w$]*)\.error\.code$/.exec(codeArg);
    const fromResult = result && messageArg === `${result[1]}.error.message` && !resultWritten(ctx, result[1]);
    const fromCatch = codeArg === 'undefined' && caughtNames(ctx, site.at).has(messageArg);
    if (fromResult || fromCatch) spans.push({ start: site.args[6][0], end: site.args[6][1] });
  }
  return spans;
}

// A result name rebound, or any of its members written: its error fields no longer prove what the host returned.
function resultWritten(ctx, name) {
  const id = escapeRe(name);
  const rebinds = [...ctx.mask.matchAll(new RegExp(`(?<![\\w$.])${id}\\s*(?:\\?\\?|\\|\\||&&)?=(?![=>])`, 'g'))]
    .filter((match) => !/\b(?:const|let|var)\s+$/.test(ctx.mask.slice(Math.max(0, match.index - 12), match.index)));
  return rebinds.length > 0 || new RegExp(`(?<![\\w$.])${id}\\s*(?:\\??\\.\\s*[\\w$]+\\s*)+(?:\\?\\?|\\|\\||&&|[-+*/%])?=(?![=>])`).test(ctx.mask)
    || new RegExp(`\\bdelete\\s+${id}\\b`).test(ctx.mask);
}

// ---------- the compatibility ledger ----------

let ledger = null;
function ledgerEntries() {
  ledger ||= JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')).entries;
  return ledger;
}
const pageErrorFingerprint = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n'), 'utf8').digest('hex');

// The ledger entry that exempts `text` at fixture-relative `relativePath` (`<fixture>/<page>.tsx`), or null. Only an
// unchanged source exempts; the contract's own fixtures (26, 27) never do.
function exemption(relativePath, text) {
  const key = String(relativePath).replace(/\\/g, '/');
  if (/^(?:26|27)-/.test(key)) return null;
  const entry = ledgerEntries().find((candidate) => candidate.path === key);
  return entry && entry.sha256 === pageErrorFingerprint(text) ? entry : null;
}

// The Layer-2 assertion over a fixture's ROOT pages (fixture-loader `files`): a failing checked page fails the fixture;
// pages that are all unchanged pre-contract captures skip, with that reason; otherwise it passes and says how many
// pages were exempt.
function gradePageErrors({ files }) {
  if (!files || !files.length) return { status: 'skip', reason: 'no .tsx files' };
  let exempt = 0;
  let checked = 0;
  for (const file of files) {
    const relative = `${path.basename(path.dirname(file.path || ''))}/${file.name}`;
    if (exemption(relative, file.content)) { exempt += 1; continue; }
    checked += 1;
    const problems = pageErrorProblems(file.content);
    if (problems.length) return { status: 'fail', reason: `${file.name}: ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}` };
  }
  if (!checked) return { status: 'skip', reason: `compatibility: ${exempt} page(s) captured before the page error contract and unchanged since (page-error-allowlist.json)` };
  return { status: 'pass', reason: exempt ? `${exempt} unchanged pre-contract page(s) exempt` : '' };
}

module.exports = {
  PAGE_ERROR_ASSERTION, LISTED_METHODS,
  pageErrorProblems, telemetrySafeSpans, gradePageErrors, pageErrorFingerprint, exemption, dataCallFamilies,
  // The lexical helpers the lookup contract (polymorphic-lookup-contract.js) compares its own canonical block with.
  canonicalLines, topLevelFunction, argRanges,
};
