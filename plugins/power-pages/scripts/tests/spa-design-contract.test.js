'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const pluginRoot = path.resolve(__dirname, '..', '..');
const repositoryRoot = path.resolve(pluginRoot, '..', '..');
const read = (file) => fs.readFileSync(path.join(pluginRoot, ...file.split('/')), 'utf8').replace(/\r\n/g, '\n');
const digest = (text) => createHash('sha256').update(text).digest('hex');
const readHead = (file) => {
  const result = spawnSync(
    'git',
    ['show', `HEAD:plugins/power-pages/${file}`],
    { cwd: repositoryRoot, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.replace(/\r\n/g, '\n');
};

// These contracts come from PR #691, merge 4d90f8783c4a08043b86fbcff8d3aded3c1b0038.
// Non-SPA adapters may reuse them, not change SPA behavior. Update these fingerprints
// only for an intentional SPA change. Normalize checkout line endings for Windows.
// The design-aesthetics.md and page-blueprints.md fingerprints were re-pinned for the
// "code site" -> "SPA site" terminology rename, which changed only each file's opening
// sentence; SPA design behavior is unchanged.
// https://github.com/microsoft/power-platform-skills/pull/691
test('non-SPA adoption leaves upstream SPA references, capture and plan rendering unchanged', () => {
  const contracts = [
    'references/design-aesthetics.md',
    'references/page-blueprints.md',
    'references/design-critique.md',
    'scripts/capture-design-review.js',
    'scripts/axe-audit.js',
    'scripts/render-createsite-plan.js',
    'skills/create-site/assets/create-site-plan.html',
  ];
  for (const file of contracts) {
    assert.equal(read(file), readHead(file), file);
  }
});

test('non-SPA dispatch does not rewrite the SPA standalone review workflow', () => {
  const source = read('skills/exceptional-web-design/SKILL.md');
  const bodyStart = source.indexOf('# Exceptional Web Design');
  assert.ok(bodyStart > 0);
  const dispatch = source.slice(0, bodyStart);
  assert.match(dispatch, /workflows\/non-spa-site\.md/);
  assert.match(dispatch, /do not continue into the workflow below/);
  assert.match(dispatch, /Do not add native discovery or questions to an already identified SPA site/);
  assert.equal(digest(source.slice(bodyStart)), 'efcd3ea21ab8524063222b95e7a39400da0aca34f0173b802e7fee2582b5381b');
});

test('SPA typography, implementation and critique completion retain the upstream contract', () => {
  const source = read('skills/create-site/SKILL.md');
  const upstream = readHead('skills/create-site/SKILL.md');
  const routed = source.split('## Phase 2: Scaffold & Launch Dev Server');
  assert.equal(routed.length, 2);
  assert.match(routed[0], /Non-SPA \(Liquid \+ Web Template\)/);
  assert.doesNotMatch(routed[1], /edit-site\/references\/styling\/design-critique|workflows\/classic-site/);
  const start = source.indexOf('### 5.7 Design Critique Pass');
  const end = source.indexOf('## Phase 6: Accessibility Verification');
  assert.ok(start >= 0 && end > start);
  const upstreamStart = upstream.indexOf('### 5.7 Design Critique Pass');
  const upstreamEnd = upstream.indexOf('## Phase 6: Accessibility Verification');
  assert.equal(source.slice(start, end), upstream.slice(upstreamStart, upstreamEnd));
  const foundations = source.split('\n').find((line) => line.startsWith('1. **Design foundations**'));
  assert.ok(foundations);
  assert.equal(
    foundations,
    upstream.split('\n').find((line) => line.startsWith('1. **Design foundations**'))
  );
  const typography = source.split('\n').find((line) => line.startsWith('| `TYPOGRAPHY_DATA`'));
  assert.ok(typography);
  assert.equal(
    typography,
    upstream.split('\n').find((line) => line.startsWith('| `TYPOGRAPHY_DATA`'))
  );
  assert.match(source, /Chosen Google Fonts verified loaded by the font check/);
});
