'use strict';
// Where an agent finds the inputs another generative page accepts (AB#6247727). The platform shows no list of a page's inputs, so passing `data` to a page
// was trial and error: a guessed key is dropped without a word. references/rules.md ("Page Input > What another page accepts") says where they are — the
// App Spec's `pages[].pageInput.data` for a page /app-builder built, and the page's own `pageInput` reads for any other page, read from a download — and the
// planner and the page-builder point to it. These tests hold the text to what the plugin's own scripts do: the download command is a real one, it writes the
// page's source where the text says, and the App Spec declaration it names is the one the page manifest carries and a download restores.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { VERBS } = require('../genpage.js');
const { pageFolderFiles } = require('../lib/genpage-sdk.js');
const { buildManifest } = require('../lib/page-manifest.js');

const PLUGIN = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(PLUGIN, ...parts), 'utf8');
const RULES = read('references', 'rules.md');
const flat = (text) => text.replace(/\s+/g, ' ');

// The subsection, from its heading to the next heading of its level or above.
function subsection(text, heading) {
  const at = text.indexOf(heading);
  assert.ok(at >= 0, `rules.md has ${heading}`);
  const rest = text.slice(at + heading.length);
  return rest.slice(0, rest.search(/\n#{2,3} /));
}
const ACCEPTS = '### What another page accepts (read it before you pass it data)';

test('rules.md says where a page\u2019s inputs are: its own pageInput reads, and for an app-builder page the App Spec\u2019s pageInput.data', () => {
  const pageInput = RULES.slice(RULES.indexOf('## Page Input'), RULES.indexOf('## Special Patterns'));
  assert.ok(pageInput.includes(ACCEPTS), 'the subsection is in the Page Input section');
  const text = flat(subsection(RULES, ACCEPTS));
  assert.match(text, /The platform shows no list of the inputs a page takes\. A page's inputs are the values its own source reads from its `pageInput` prop: `pageInput\.entityName`, `pageInput\.recordId`, and each key it reads from `pageInput\.data`\./);
  assert.match(text, /its App Spec declares the inputs as `pages\[\]\.pageInput\.data` \(each key with its type\)\. The producing page declares the same keys in `navigatesTo\[\]\.data`\. `download-model-app\.js` writes both into the spec from the app's page manifest\./);
  assert.match(text, /Then search `<working-dir>\/targets\/<target-page-id>\/page\.tsx` for `pageInput`\. Each key read from `pageInput\.data` is an input/);
  assert.match(text, /Pass only the keys the target reads, with the same names, in `data` of the `navigateTo` call\./);
  assert.match(text, /A page that reads no `pageInput` takes no input: navigate to it without `data`\./);
});

test('the download the text gives is the page verb as it is: its flags are the verb\u2019s, and it writes the page\u2019s source as page.tsx in a folder named for the page', () => {
  const block = /```powershell\n([\s\S]*?)```/.exec(subsection(RULES, ACCEPTS));
  assert.ok(block, 'the subsection gives the command');
  const command = block[1].trim();
  assert.match(command, /^node "\$\{PLUGIN_ROOT\}\/scripts\/genpage\.js" download /);
  const flags = [...command.matchAll(/--([a-z-]+)/g)].map((m) => m[1]);
  assert.deepEqual(flags, ['env', 'page-id', 'output-directory']);
  for (const flag of flags) assert.ok(VERBS.download.known.includes(flag), `--${flag} is a flag of genpage.js download`);
  for (const flag of VERBS.download.required) assert.ok(flags.includes(flag), `--${flag} is required by genpage.js download, and given`);
  assert.match(command, /--output-directory '<working-dir>\/targets'/, 'a folder of its own, not the working directory');
  assert.ok(!/--app-id/.test(command), 'any page of the environment: no app to prove it is in');
  // What a download writes for a page (`<output-directory>/<page id>/…`): the page's source is page.tsx.
  const files = pageFolderFiles({ source: 'export default function P(){ return null; }', dataSources: [], conversation: [] });
  assert.equal(files['page.tsx'], 'export default function P(){ return null; }');
  assert.match(flat(subsection(RULES, ACCEPTS)), /Do not use the working directory, and record no base marker, because this is a read/);
});

test('the App Spec declaration the text names is the one the page manifest carries, so a download restores it', () => {
  const spec = {
    app: { name: 'Orders' }, solution: { publisherPrefix: 'contoso' },
    pages: [
      { key: 'list', name: 'Orders', navigatesTo: [{ targetKey: 'detail', data: { orderId: 'string' } }] },
      { key: 'detail', name: 'Order', pageInput: { data: { orderId: 'string' } }, directEntry: { behavior: 'selector' } },
    ],
  };
  const manifest = buildManifest(spec, new Map([['list', '00000000-0000-4000-8000-000000000001'], ['detail', '00000000-0000-4000-8000-000000000002']]));
  const detail = manifest.pages.find((p) => p.key === 'detail');
  assert.deepEqual(detail.pageInput, { data: { orderId: 'string' } });
  const list = manifest.pages.find((p) => p.key === 'list');
  assert.deepEqual(list.navigatesTo, [{ targetKey: 'detail', data: { orderId: 'string' } }]);
  assert.match(read('scripts', 'download-model-app.js'), /if \(m\.pageInput !== undefined\) p\.pageInput = m\.pageInput;/, 'a download writes the manifest\u2019s declaration into the spec');
});

test('the navigation rule, the planner and the page-builder send an agent to that subsection before it passes data to a page the plan does not build', () => {
  assert.match(flat(RULES), /\*\*Passing data to a page this plan does not build:\*\* first read the keys that page accepts — see \*\*Page Input > What another page accepts\*\*\. Never guess the names\./);
  const planner = flat(read('agents', 'genpage-planner.md'));
  assert.match(planner, /For a page that navigates to an existing page that this plan does not build \(a page of the chosen app, by its page id\), read what that page accepts before you plan the call\./);
  assert.match(planner, /write in the page's \*\*Interactions\*\* the target's page id and the exact `data` keys it reads, each with the type it converts the value to/);
  const builder = flat(read('agents', 'genpage-page-builder.md'));
  assert.match(builder, /When the target is a page that this plan does not build, use the keys that page reads \(rules\.md \*\*Page Input > What another page accepts\*\*\), never guessed names\./);
});
