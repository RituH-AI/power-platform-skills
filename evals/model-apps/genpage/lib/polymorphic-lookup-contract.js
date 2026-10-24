'use strict';
// Lookup identities in a generated page (references/rules.md "Lookup references"), graded against a scenario's lookup metadata —
// the successful answer of scripts/get-lookup-metadata.js the run saved, never a guess. It is a CLOSED grammar, not a theorem
// prover: it accepts the canonical forms the rules teach and refuses everything else as unverifiable, so an equivalent but
// different program fails rather than passes unread.
//
//   lookups: [{ table: 'opportunity', column: 'customerid', readProperty: '_customerid_value', targets: ['account', 'contact'],
//               paths: [{ target: 'account', navigationProperty: 'customerid_account', referencedKey: 'accountid' }, …] }]
//
// What is accepted, and nothing else:
//   - the canonical normalizer (`normalizeLookupReference` and its two patterns) copied unchanged — the oracle is rules.md's own
//     block, compared after comments are blanked and each line trimmed (blank lines dropped, literal text exact);
//   - a call `normalizeLookupReference(<row>, '<readProperty>', ['<target>', …])` whose literal targets are the lookup's COMPLETE
//     target set, bound to a `const`, checked by `if (<n>.state !== 'resolved') return…` before its `.reference` is used, and at
//     most aliased once more as `const <r> = <n>.reference;` (the "documented immutable alias");
//   - a resolved reference's `.id` as a filter operand (`_<field>_value eq ${<r>.id}`), a `retrieveRow` id and a `navigateTo`
//     entityId, with its `.table` as the table — or a literal table where the reference's table is PROVEN to be it: after an
//     early `if (<r>.table !== '<table>') return…;` that is a statement of a block holding the use, or inside the block of
//     `if (<r>.table === '<table>') { … }` (an inverted, nested or merely mentioned comparison proves nothing);
//   - typed paths in a filter (`<navigation>/<column>`) only through a verified concrete path of the queried table; a comparison
//     of such a path with a reference's id only where that reference's table is proven, the same way, to be the path's target;
//   - a lookup property in a `select` list, in its FormattedValue annotation key, in a `ne null` / `eq null` predicate, or as a
//     write key whose value is `null` or the guarded table formatter of pitfall E (directly or through one `const`).
// Refused: a raw `row._x_value` / `row['_x_value']` read, a lookup annotation read outside the normalizer, a partial target set, a
// fixed table for a multi-target lookup, an empty-string clear, and any other use of a lookup property.
// What it does not decide: whether a view is meant to cover every target (`_x_value ne null`) or one — the scenario's own
// expectations say that — nor whether the rows a page shows are the ones the maker meant. A reference handed on through a
// parameter, a state value or a second alias is not followed: a typed-path or lookup-id filter built from it is refused, while a
// navigation or a retrieve by such an id is not recognized as a lookup's at all, so a scenario page keeps the canonical forms.

const fs = require('node:fs');
const path = require('node:path');
const { blankNonCodePreservingTemplateExpressions, blankLiterals, commentRanges } = require('../../../../plugins/model-apps/scripts/lib/source-literals.js');
const { groupEnd, literalString, escapeRe, expressionEnd } = require('./source-evidence.js');
const { canonicalLines, topLevelFunction, argRanges } = require('./page-error-evidence.js');

const RULES_PATH = path.join(__dirname, '..', '..', '..', '..', 'plugins', 'model-apps', 'references', 'rules.md');
const HEADING = '### Lookup references (Customer, Owner, Regarding and every other lookup)';
const NORMALIZER = 'normalizeLookupReference';
const PATTERNS = ['LOOKUP_GUID', 'LOOKUP_QUALIFIED'];
const IDENT = '[A-Za-z_$][\\w$]*';

let canonical = null;
// The canonical normalizer from rules.md: { fn, patterns: Map(name → statement) }, each as its canonical lines.
function canonicalNormalizer() {
  if (canonical) return canonical;
  const rules = fs.readFileSync(RULES_PATH, 'utf8').replace(/\r\n/g, '\n');
  const start = rules.indexOf(`\n${HEADING}\n`);
  if (start < 0) throw new Error('references/rules.md has no "Lookup references" section');
  const rest = rules.slice(start + HEADING.length + 2);
  const next = rest.search(/\n#{2,3} /);
  const section = next < 0 ? rest : rest.slice(0, next);
  const block = [...section.matchAll(/```typescript\n([\s\S]*?)\n```/g)].map((match) => match[1]).find((text) => text.includes(`function ${NORMALIZER}(`));
  if (!block) throw new Error('references/rules.md does not publish the canonical lookup normalizer');
  const mask = blankNonCodePreservingTemplateExpressions(block);
  const range = topLevelFunction(block, mask, NORMALIZER);
  const patterns = new Map();
  for (const name of PATTERNS) {
    const declared = new RegExp(`^const ${name} = .*;$`, 'm').exec(block);
    if (!declared) throw new Error(`references/rules.md's normalizer block has no ${name}`);
    patterns.set(name, declared[0].trim());
  }
  canonical = { fn: canonicalLines(block.slice(range.start, range.end)).join('\n'), patterns };
  return canonical;
}

// How many brackets are open at `at` (0 at the module's top level).
function depthAt(mask, at) {
  let depth = 0;
  for (let i = 0; i < at; i += 1) {
    if ('({['.includes(mask[i])) depth += 1;
    else if (')}]'.includes(mask[i])) depth -= 1;
  }
  return depth;
}

// The page's normalizer is the canonical one, declared once at the top level with its two patterns.
function normalizerProblems(code) {
  const { fn, patterns } = canonicalNormalizer();
  const mask = blankNonCodePreservingTemplateExpressions(code);
  const problems = [];
  const declarations = [...mask.matchAll(new RegExp(`\\bfunction\\s+${NORMALIZER}\\s*\\(`, 'g'))];
  const other = new RegExp(`\\b(?:const|let|var)\\s+${NORMALIZER}\\b`).test(mask);
  if (declarations.length !== 1 || other) return [`the page must declare ${NORMALIZER} once, as the top-level function references/rules.md publishes`];
  const range = topLevelFunction(code, mask, NORMALIZER);
  if (!range) return [`${NORMALIZER} must be a top-level function`];
  if (canonicalLines(code.slice(range.start, range.end)).join('\n') !== fn) problems.push(`${NORMALIZER} is not the canonical normalizer — copy it unchanged from references/rules.md "Lookup references"`);
  for (const [name, statement] of patterns) {
    const found = [...mask.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`, 'g'))];
    const line = found.length === 1 && depthAt(mask, found[0].index) === 0
      ? code.slice(found[0].index, code.indexOf('\n', found[0].index) < 0 ? code.length : code.indexOf('\n', found[0].index)).trim() : null;
    if (line !== statement) problems.push(`${name} is not the canonical pattern — copy it unchanged from references/rules.md "Lookup references"`);
  }
  return problems;
}

// ---------- literals ----------

// Every string and template literal of the code: { quote, start, end, text } (start/end include the delimiters). blankLiterals keeps
// each delimiter and blanks everything inside — a template's expressions and the literals nested in them included — and blanks
// comments, regular expressions and JSX text, so the next delimiter of the same kind closes a literal.
function literalRanges(code) {
  const bare = blankLiterals(code);
  const out = [];
  for (let i = 0; i < bare.length; i += 1) {
    const quote = bare[i];
    if ((quote !== '\'' && quote !== '"' && quote !== '`') || code[i] !== quote) continue;
    const end = bare.indexOf(quote, i + 1);
    if (end < 0) break;
    out.push({ quote, start: i, end: end + 1, text: code.slice(i + 1, end) });
    i = end;
  }
  return out;
}

// A template's text pieces and `${…}` expressions, from its code: `a ${x.id} b` → { text: 'a \u0000 b', expressions: ['x.id'] }
// (each expression's place in the text is a NUL, so a predicate can be matched across it). `maskP` (the preserving mask) blanks the
// literals nested in an expression, so their braces are not counted.
function templateParts(code, maskP, literal) {
  const expressions = [];
  let text = '';
  for (let i = literal.start + 1; i < literal.end - 1; i += 1) {
    if (code[i] === '\\') { text += code.slice(i, i + 2); i += 1; continue; }
    if (code[i] === '$' && code[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      for (; j < literal.end - 1 && depth; j += 1) {
        if (maskP[j] === '{') depth += 1;
        else if (code[j] === '}' && (maskP[j] === '}' || maskP[j] === ';')) depth -= 1;
      }
      expressions.push(code.slice(i + 2, j - 1).trim());
      text += '\u0000';
      i = j - 1;
      continue;
    }
    text += code[i];
  }
  return { text, expressions };
}

const squash = (text) => String(text).replace(/\s+/g, '').replace(/\?\./g, '.').replace(/"/g, '\'');

// ---------- normalizations and the references they resolve ----------

// Each `const <n> = normalizeLookupReference(<row>, '<property>', [<targets>])`: the lookup it reads, its binding, where its guard
// `if (<n>.state !== 'resolved') return…` is, and the names that hold its resolved reference (`<n>.reference`, and at most one
// `const <r> = <n>.reference;`).
function normalizations(code, mask, lookups, problems) {
  const found = [];
  for (const match of mask.matchAll(new RegExp(`(?<![\\w$.])${NORMALIZER}\\s*\\(`, 'g'))) {
    if (/\bfunction\s*$/.test(mask.slice(Math.max(0, match.index - 20), match.index))) continue;
    const open = match.index + match[0].length - 1;
    const { args } = argRanges(mask, open);
    const property = args[1] ? literalString(code.slice(args[1][0], args[1][1])) : null;
    const lookup = lookups.find((entry) => entry.readProperty === property);
    if (args.length !== 3 || !lookup) {
      problems.push(`${NORMALIZER} is called for ${property ? `'${property}', which is not a recorded lookup` : 'a property that is not a literal recorded lookup'}`);
      continue;
    }
    const list = code.slice(args[2][0], args[2][1]).trim();
    const targets = /^\[[\s\S]*\]$/.test(list) ? list.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean).map(literalString) : [null];
    if (targets.some((target) => target === null) || [...targets].sort().join(',') !== [...lookup.targets].sort().join(',')) {
      problems.push(`${property} is normalized with targets ${list.replace(/\s+/g, ' ')}, not its complete metadata target set [${lookup.targets.join(', ')}]`);
    }
    const line = mask.slice(mask.lastIndexOf('\n', match.index) + 1, match.index);
    const bound = new RegExp(`\\bconst\\s+(${IDENT})\\s*(?::[^=]+)?=\\s*$`).exec(line);
    if (!bound) {
      problems.push(`the normalization of ${property} is not bound to a const the page checks before it uses the reference`);
      continue;
    }
    const name = bound[1];
    const guard = new RegExp(`\\bif\\s*\\(\\s*${escapeRe(name)}\\s*\\.\\s*state\\s*!==?\\s*(['"])resolved\\1\\s*\\)\\s*\\{?\\s*(?:return|throw)\\b`, 'g');
    guard.lastIndex = match.index;
    const guarded = guard.exec(code);
    const names = [`${name}.reference`];
    for (const alias of mask.matchAll(new RegExp(`\\bconst\\s+(${IDENT})\\s*(?::[^=]+)?=\\s*${escapeRe(name)}\\s*\\.\\s*reference\\s*;`, 'g'))) names.push(alias[1]);
    found.push({ name, lookup, at: match.index, guardAt: guarded ? guarded.index : -1, names, ...enclosingBlock(mask, match.index) });
  }
  return found;
}

// The block a normalization is made in: { scopeStart, scopeEnd } of the innermost `{ … }` around `at` (the module when none). A
// reference is read only inside it, so two functions that each name their reference `reference` are never confused. `bare` blanks
// every literal, a template's expressions included, so the braces counted are the code's own.
function enclosingBlock(bare, at) {
  let depth = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    if (bare[i] === '}') depth += 1;
    else if (bare[i] === '{') {
      if (depth) { depth -= 1; continue; }
      return { scopeStart: i, scopeEnd: groupEnd(bare, i) };
    }
  }
  return { scopeStart: 0, scopeEnd: bare.length };
}

// The reference an expression's `.id` or `.table` reads at `at`: { entry, holder, member: 'id' | 'table' }, or null. The
// normalization it comes from is the nearest one before `at` whose block holds `at`; a name from anywhere else (a parameter, a
// state value) is not followed, and so is no reference.
function referenceOf(found, text, at) {
  const value = squash(text);
  const candidates = found.filter((entry) => entry.at < at && at < entry.scopeEnd && entry.scopeStart < at).sort((a, b) => b.at - a.at);
  for (const entry of candidates) {
    for (const holder of entry.names) {
      const compact = holder.replace(/\s+/g, '');
      if (value === `${compact}.id`) return { entry, holder: compact, member: 'id' };
      if (value === `${compact}.table`) return { entry, holder: compact, member: 'table' };
    }
  }
  return null;
}

// A use of a reference, inside the block of its normalization, before the guard (or with no guard at all) is not of a resolved pair.
// `maskP` keeps a template's expressions, so `${reference.id}` in a filter counts as a use.
function unguardedUses(maskP, found) {
  const problems = [];
  for (const entry of found) {
    for (const holder of entry.names) {
      const parts = holder.split('.').map(escapeRe).join('\\s*\\.\\s*');
      for (const use of maskP.matchAll(new RegExp(`(?<![\\w$.])${parts}\\s*\\.\\s*(?:id|table)\\b`, 'g'))) {
        if (use.index <= entry.at || use.index >= entry.scopeEnd) continue;
        if (entry.guardAt < 0 || use.index < entry.guardAt) {
          problems.push(`${holder} is used before the page checks that ${entry.name}.state is 'resolved'`);
          break;
        }
      }
    }
  }
  return problems;
}

// Whether `<holder>.table` is PROVEN to be '<table>' at `at`, by one of two bounded forms (a comparison anywhere else — the
// inverted `if (<holder>.table === '<table>') return;`, one inside another condition or an `else`, one in a branch `at` is not
// in — proves nothing):
//   - an early exit `if (<holder>.table !== '<table>') return…;` (or `throw`, braced or not) that is a statement of a block
//     holding `at`, after the reference is bound and before `at` — every path to `at` passes it with the table equal;
//   - `at` inside the braced block of `if (<holder>.table === '<table>') { … }`.
// `mask` blanks every literal and comment, so the `if`, its braces and its statement position are the code's own.
function tableChecked(code, mask, reference, table, at) {
  const parts = reference.holder.split('.').map(escapeRe).join('\\s*\\.\\s*');
  const test = new RegExp(`\\bif\\s*\\(\\s*${parts}\\s*\\.\\s*table\\s*(===?|!==?)\\s*(['"])${escapeRe(table)}\\2\\s*\\)`, 'g');
  for (const match of code.matchAll(test)) {
    if (match.index <= reference.entry.at || match.index >= at || mask.slice(match.index, match.index + 2) !== 'if') continue;
    // A statement of its own block: nothing but `;`, `{` or `}` before it (never `else if`, a label or another `if`).
    const before = mask.slice(0, match.index).trimEnd();
    if (before && !';{}'.includes(before[before.length - 1])) continue;
    const close = match.index + match[0].length - 1;
    let then = close + 1;
    while (/\s/.test(mask[then])) then += 1;
    if (match[1].startsWith('!')) {
      if (!/^(?:\{\s*)?(?:return|throw)\b/.test(mask.slice(then))) continue;
      const block = enclosingBlock(mask, match.index);
      if (block.scopeStart < at && at < block.scopeEnd) return true;
    } else if (mask[then] === '{' && then < at && at < groupEnd(mask, then)) {
      return true;
    }
  }
  return false;
}

// ---------- writes ----------

// The value written to a lookup key: `null`, or the guarded table formatter of pitfall E —
//   selected.table === 'account' ? `/account(${selected.id})` : `/contact(${selected.id})`
// in which each tested table is the table it formats, every table is one of the lookup's targets, and together they are its
// complete target set; a single template only for a single-target lookup. Read whitespace-insensitively; anything else is refused.
function writeValueProblem(value, lookup) {
  const text = squash(value);
  if (text === 'null') return null;
  if (text === '\'\'' || text === '``') return `${lookup.readProperty} is cleared with an empty string — clear a lookup with null`;
  const branch = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.table===('[a-z_][a-z0-9_]*')\?`\/([a-z_][a-z0-9_]*)\(\$\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.id\}\)`:/;
  const tail = /^`\/([a-z_][a-z0-9_]*)\(\$\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.id\}\)`$/;
  const tested = [];
  let holder = null;
  let rest = text;
  for (let match = branch.exec(rest); match; match = branch.exec(rest)) {
    const table = match[2].slice(1, -1);
    if (match[1] !== match[4] || table !== match[3] || (holder !== null && holder !== match[1])) return `${lookup.readProperty} is written by a formatter whose branches do not each format the table they test`;
    holder = match[1];
    tested.push(table);
    rest = rest.slice(match[0].length);
  }
  const last = tail.exec(rest);
  if (!last || (holder !== null && holder !== last[2])) return `${lookup.readProperty} is written by an expression the lookup grammar cannot verify — build it with the guarded formatter of references/rules.md pitfall E`;
  const tables = [...tested, last[1]];
  if (tables.some((table) => !lookup.targets.includes(table)) || new Set(tables).size !== tables.length) return `${lookup.readProperty} is written to a table that is not one of its targets`;
  if (tables.length !== lookup.targets.length) {
    return lookup.targets.length > 1 && !tested.length
      ? `${lookup.readProperty} is written to a fixed table, but the lookup has ${lookup.targets.length} targets — choose the table from the selected pair`
      : `${lookup.readProperty} is written by a formatter that does not cover its complete target set`;
  }
  return null;
}

// The value at a write key `<key>: <value>` (the colon at `colon`), followed through one `const` when it is a bare name.
function writtenValue(code, mask, colon) {
  const end = expressionEnd(mask, colon + 1);
  const value = code.slice(colon + 1, end).trim();
  const name = new RegExp(`^${IDENT}$`).exec(value);
  if (!name) return value;
  const declared = [...mask.matchAll(new RegExp(`\\bconst\\s+${escapeRe(name[0])}\\s*(?::[^=]+)?=`, 'g'))].filter((match) => match.index < colon).pop();
  if (!declared) return value;
  const from = declared.index + declared[0].length;
  return code.slice(from, expressionEnd(mask, from)).trim();
}

// Whether the object literal holding `at` is the payload argument of `dataApi.createRow(…)` / `dataApi.updateRow(…)`.
function inWritePayload(mask, at) {
  let depth = 0;
  for (let i = at; i >= 0; i -= 1) {
    if ('})]'.includes(mask[i])) depth += 1;
    else if ('{(['.includes(mask[i])) {
      if (depth) { depth -= 1; continue; }
      if (mask[i] !== '{') return false;
      const before = mask.slice(0, i);
      return /\bdataApi\s*\??\.\s*(?:createRow|updateRow)\s*\([^()]*$/.test(before) && /,\s*$/.test(before);
    }
  }
  return false;
}

// ---------- consumers and typed paths ----------

// `<name>: <value>` of an object literal's own text, whitespace-insensitive; '' when absent.
function fieldValue(code, mask, open, close, name) {
  const field = new RegExp(`(?<![\\w$.])${name}\\s*:`, 'g');
  field.lastIndex = open;
  for (let match = field.exec(mask); match && match.index < close; match = field.exec(mask)) {
    let depth = 0;
    for (let i = open + 1; i < match.index; i += 1) { if ('({['.includes(mask[i])) depth += 1; else if (')}]'.includes(mask[i])) depth -= 1; }
    if (depth) continue;
    let from = match.index + match[0].length;
    while (/\s/.test(mask[from])) from += 1;
    return Object.assign(new String(code.slice(from, expressionEnd(mask, from)).trim()), { start: from });
  }
  return '';
}

function consumerProblems(code, mask, found, lookups) {
  const problems = [];
  const raw = (text) => lookups.some((lookup) => new RegExp(`(?<![\\w$])${escapeRe(lookup.readProperty)}(?![\\w$])`).test(text));
  const check = (label, table, id, at, literalTable) => {
    if (raw(id)) { problems.push(`${label} uses a raw lookup value as the id — normalize it and use the resolved reference's bare id`); return; }
    const reference = referenceOf(found, id, at);
    if (!reference || reference.member !== 'id') return;
    const tableRef = referenceOf(found, table, at);
    if (tableRef && tableRef.member === 'table' && tableRef.holder === reference.holder) return;
    const literal = literalTable(table);
    if (literal !== null && (reference.entry.lookup.targets.length === 1 ? reference.entry.lookup.targets[0] === literal : tableChecked(code, mask, reference, literal, at))) return;
    problems.push(`${label} opens ${reference.holder}.id in ${table || 'a table'} that is not the reference's own table — use ${reference.holder}.table, or check it first`);
  };
  for (const match of mask.matchAll(/(?<![\w$])navigateTo\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const { args } = argRanges(mask, open);
    if (!args[0] || mask[args[0][0]] !== '{') continue;
    const [start, end] = [args[0][0], groupEnd(mask, args[0][0])];
    const id = fieldValue(code, mask, start, end, 'entityId');
    if (id) check('a navigateTo', fieldValue(code, mask, start, end, 'entityName'), id, match.index, (text) => literalString(text));
  }
  for (const match of mask.matchAll(/\bdataApi\s*\??\.\s*retrieveRow\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const { args } = argRanges(mask, open);
    if (!args[1] || mask[args[1][0]] !== '{') continue;
    const id = fieldValue(code, mask, args[1][0], groupEnd(mask, args[1][0]), 'id');
    if (id) check('a retrieveRow', code.slice(args[0][0], args[0][1]), id, match.index, (text) => literalString(text));
  }
  return problems;
}

// The filter of each `dataApi.queryTable('<table>', { filter: … })`, as its literal (directly, or through one `const` — the
// `filter` shorthand included): [{ table, literal, at }].
function queryFilters(code, mask, literals) {
  const out = [];
  for (const match of mask.matchAll(/\bdataApi\s*\??\.\s*queryTable\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const { args } = argRanges(mask, open);
    const table = args[0] ? literalString(code.slice(args[0][0], args[0][1])) : null;
    if (!table || !args[1] || mask[args[1][0]] !== '{') continue;
    const close = groupEnd(mask, args[1][0]);
    const field = fieldValue(code, mask, args[1][0], close, 'filter');
    let value = String(field);
    let at = field ? field.start : -1;
    if (!value && /(?<![\w$.])filter\s*[,}]/.test(mask.slice(args[1][0], close + 1))) value = 'filter';
    if (new RegExp(`^${IDENT}$`).test(value)) {
      const declared = [...mask.matchAll(new RegExp(`\\bconst\\s+${escapeRe(value)}\\s*(?::[^=]+)?=\\s*`, 'g'))].filter((d) => d.index < match.index).pop();
      at = declared ? declared.index + declared[0].length : -1;
    }
    const literal = literals.find((entry) => entry.start === at);
    if (literal) out.push({ table, literal, at: match.index });
  }
  return out;
}

function pathProblems(code, mask, maskP, found, lookups, targetColumns, filters) {
  const problems = [];
  for (const { table, literal, at } of filters) {
    const { text, expressions } = literal.quote === '`' ? templateParts(code, maskP, literal) : { text: literal.text, expressions: [] };
    const bare = text.replace(/'[^'\u0000]*'/g, '\'\'');
    for (const match of bare.matchAll(/(?<![\w/])([A-Za-z_][\w]*)\/([A-Za-z_][\w]*)(?![\w/])(\s+eq\s+\u0000)?/g)) {
      const [, via, column, compared] = match;
      const path = lookups.filter((lookup) => lookup.table === table).flatMap((lookup) => (lookup.paths || []).map((entry) => ({ ...entry, lookup })))
        .find((entry) => entry.navigationProperty === via);
      if (!path) { problems.push(`a filter on ${table} goes through ${via}, which is not a verified concrete lookup path of ${table}`); continue; }
      const columns = [path.referencedKey, ...((targetColumns || {})[path.target] || [])].map((name) => String(name).toLowerCase());
      if (!columns.includes(column.toLowerCase())) problems.push(`a filter on ${table} names ${via}/${column}, which is not a verified column of ${path.target}`);
      if (compared) {
        const expression = expressions[[...bare.slice(0, match.index + match[0].length)].filter((ch) => ch === '\u0000').length - 1];
        const reference = referenceOf(found, expression || '', at);
        if (!reference || reference.member !== 'id') problems.push(`${via}/${column} is compared with ${expression || 'a value'} that is not a resolved reference's bare id`);
        else if (!tableChecked(code, mask, reference, path.target, at)) problems.push(`${via}/${column} is compared with ${reference.holder}.id before the page checks that ${reference.holder}.table is ${path.target}`);
      }
    }
  }
  return problems;
}

// ---------- every mention of a lookup property ----------

// Each place the page names a recorded lookup's read property must be one the grammar accepts (see the header); the rest are
// refused, a raw read and a direct annotation read by name.
function mentionProblems(code, mask, maskP, literals, comments, found, lookups) {
  const problems = [];
  const normalizeArgs = new Set();
  for (const match of mask.matchAll(new RegExp(`(?<![\\w$.])${NORMALIZER}\\s*\\(`, 'g'))) {
    if (/\bfunction\s*$/.test(mask.slice(Math.max(0, match.index - 20), match.index))) continue;
    const { args } = argRanges(mask, match.index + match[0].length - 1);
    if (args[1]) normalizeArgs.add(args[1][0]);
  }
  const inComment = (at) => comments.some(({ start, end }) => start <= at && at < end);
  for (const lookup of lookups) {
    const property = lookup.readProperty;
    const accepted = (predicate, value) => (/^(?:eq|ne)$/.test(predicate) && value === 'null');
    for (const match of code.matchAll(new RegExp(`(?<![\\w$])${escapeRe(property)}(?![\\w$])`, 'g'))) {
      const at = match.index;
      if (inComment(at)) continue;
      const literal = literals.find((entry) => entry.start < at && at < entry.end);
      const inExpression = literal && literal.quote === '`' && maskP[at] === code[at];
      if (literal && !inExpression) {
        const exact = literal.text === property;
        const after = literal.text.slice(literal.text.indexOf(property) + property.length);
        if (exact && normalizeArgs.has(literal.start)) continue;
        if (exact && /\bselect\s*:\s*\[[^\]]*$/.test(mask.slice(0, literal.start))) continue;
        if (exact && /^\s*:/.test(mask.slice(literal.end))) {
          if (!inWritePayload(mask, literal.start)) problems.push(`${property} is a key of an object that is not a createRow/updateRow payload`);
          else { const why = writeValueProblem(writtenValue(code, mask, mask.indexOf(':', literal.end)), lookup); if (why) problems.push(why); }
          continue;
        }
        if (exact && /\[\s*$/.test(mask.slice(0, literal.start))) { problems.push(`the page reads the raw ${property} value — normalize the row with ${NORMALIZER} first`); continue; }
        if (after.startsWith('@OData.Community.Display.V1.FormattedValue')) continue;
        if (after.startsWith('@Microsoft.Dynamics.CRM.')) { problems.push(`the page reads the ${property}${after.split(/['"`\s]/)[0]} annotation itself — only ${NORMALIZER} reads target evidence`); continue; }
        if (exact) { problems.push(`'${property}' is used in a way the lookup grammar cannot verify`); continue; }
        // Inside a filter or other text: every predicate on the property must be `eq null` / `ne null`, or an `eq` with a resolved
        // reference's bare id.
        const parts = literal.quote === '`' ? templateParts(code, maskP, literal) : { text: literal.text, expressions: [] };
        const predicates = [...parts.text.matchAll(new RegExp(`(?<![\\w$/])${escapeRe(property)}\\s+(eq|ne|gt|ge|lt|le)\\s+(null\\b|\\u0000|\\S+)`, 'g'))];
        if (!predicates.length) { problems.push(`${property} appears in text the lookup grammar cannot verify: ${literal.text.slice(0, 60)}`); continue; }
        for (const predicate of predicates) {
          if (accepted(predicate[1], predicate[2])) continue;
          if (predicate[1] === 'eq' && predicate[2] === '\u0000') {
            const index = [...parts.text.slice(0, predicate.index + predicate[0].length)].filter((ch) => ch === '\u0000').length - 1;
            const reference = referenceOf(found, parts.expressions[index] || '', literal.start);
            if (reference && reference.member === 'id' && reference.entry.lookup === lookup) continue;
            problems.push(`${property} is compared with ${parts.expressions[index] || 'a value'}, which is not the bare id of a resolved ${property} reference`);
            continue;
          }
          problems.push(`${property} ${predicate[1]} ${predicate[2] === '\u0000' ? 'a value' : predicate[2]} is a lookup predicate the grammar cannot verify`);
        }
        continue;
      }
      // In code: a member read is a raw read; a key is a write; anything else is unverifiable.
      if (/\.\s*$|\?\.\s*$/.test(maskP.slice(0, at))) { problems.push(`the page reads the raw ${property} value — normalize the row with ${NORMALIZER} first`); continue; }
      if (/^\s*:/.test(maskP.slice(at + property.length))) {
        if (!inWritePayload(mask, at)) problems.push(`${property} is a key of an object that is not a createRow/updateRow payload`);
        else { const why = writeValueProblem(writtenValue(code, mask, mask.indexOf(':', at + property.length)), lookup); if (why) problems.push(why); }
        continue;
      }
      problems.push(`${property} is used in a way the lookup grammar cannot verify`);
    }
  }
  if (literals.some((entry) => /@odata\.bind/i.test(entry.text))) problems.push('the page binds a lookup with @odata.bind, which the DataAPI drops — write _<field>_value (rules.md DataAPI Rule 13)');
  return problems;
}

/**
 * The lookup problems of one page: its normalizer, every use of a recorded lookup, the consumers of a resolved reference and the
 * typed paths of its filters. [] when it holds to the grammar.
 * @param {string} content - the page source
 * @param {{ lookups: object[], targetColumns?: Record<string, string[]> }} scenario - the run's lookup metadata (see the header) and
 *   the target columns verified beside it (a target's primary name column a search reads)
 */
function lookupContractProblems(content, { lookups, targetColumns = {} }) {
  const code = String(content ?? '');
  if (!Array.isArray(lookups) || !lookups.length) return ['the scenario names no lookup metadata to grade against'];
  let mask;
  let maskP;
  try {
    maskP = blankNonCodePreservingTemplateExpressions(code);
    mask = blankLiterals(code);
  } catch (error) {
    return [`the page could not be read (${error.message})`];
  }
  const problems = [];
  try {
    problems.push(...normalizerProblems(code));
    const literals = literalRanges(code);
    const comments = commentRanges(code);
    const found = normalizations(code, mask, lookups, problems);
    problems.push(...unguardedUses(maskP, found));
    problems.push(...mentionProblems(code, mask, maskP, literals, comments, found, lookups));
    problems.push(...consumerProblems(code, mask, found, lookups));
    problems.push(...pathProblems(code, mask, maskP, found, lookups, targetColumns, queryFilters(code, mask, literals)));
  } catch (error) {
    problems.push(`the page's lookup code could not be read (${error.message})`);
  }
  return [...new Set(problems)];
}

/**
 * The lookups of a successful scripts/get-lookup-metadata.js answer, in the shape lookupContractProblems takes (each with its
 * table), or null when the answer is not a successful one:
 *   { "ok": true, "tables": [ { "logicalName": "opportunity", "lookups": [ { "column", "readProperty", "targets", "paths", … } ] } ] }
 * Every lookup of every table read is kept, not only the ones a plan records: a page that touches another lookup of the same
 * table is graded on it too.
 * @param {object} evidence - the parsed answer
 */
function evidenceLookups(evidence) {
  if (!evidence || evidence.ok !== true || !Array.isArray(evidence.tables)) return null;
  return evidence.tables.flatMap((table) => (Array.isArray(table?.lookups) ? table.lookups : []).map((lookup) => ({
    table: table.logicalName,
    column: lookup.column,
    readProperty: lookup.readProperty,
    targets: Array.isArray(lookup.targets) ? lookup.targets : [],
    paths: Array.isArray(lookup.paths) ? lookup.paths : [],
  })));
}

module.exports = { lookupContractProblems, normalizerProblems, canonicalNormalizer, literalRanges, evidenceLookups };
