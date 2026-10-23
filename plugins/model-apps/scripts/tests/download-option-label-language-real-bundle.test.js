'use strict';
// The LANGUAGE of Choice option labels two options share, through download and rebuild — over the REAL vendored SDK, the plugin's own
// HTTP client and the stateful fake Dataverse the lifecycle tests share (helpers/fake-lifecycle-org.js, which stores each label under the
// LCID it was sent with, as Dataverse does).
//
// Dataverse lets two options of a column carry the same label. A download keeps a label held in one language other than its authoring
// language as a one-entry map, and the validator refuses a text two options share when it is not visible on the line. A download used to
// write EVERY option of such a column as a plain string to keep the column typed — so one shared label moved every option's label, the
// unrelated ones too, into the language a rebuild resolves, and no warning said a language was lost. These cases pin, by what a fresh
// environment holds after the rebuild:
//   * two options sharing their text in ONE language keep it (a duplicate the validator warns about, as it does two plain strings), and
//     so does every other option;
//   * two options sharing their text in DIFFERENT languages are the only ones written as plain strings — the only shape the spec takes
//     for them — and the download names each label that loses its language; every other option keeps its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeTempDir } = require('./helpers/temp-dirs.js');
const { createLifecycleOrg } = require('./helpers/fake-lifecycle-org.js');
const { createLifecycleHarness, appUniqueName } = require('./helpers/lifecycle-harness.js');
const { validateAppSpec } = require('../lib/app-spec.js');

const LANGUAGES = { baseLanguage: 1033, provisionedLanguages: [1033, 1036, 3082] };
// A Choice column whose options are labelled in French and Spanish only, built in an environment whose base language is English.
const spec = {
  schemaVersion: 2,
  solution: { uniqueName: 'ContosoStages', displayName: 'Contoso Stages', publisherPrefix: 'contoso' },
  app: { name: 'Stages' },
  entities: [{
    schemaName: 'contoso_item', displayName: 'Item', primaryAttribute: { schemaName: 'contoso_name', displayName: 'Name' },
    columns: [{ schemaName: 'contoso_stage', type: 'Choice', displayName: 'Stage', options: [{ 1036: 'Ouvert' }, { 3082: 'Abierto' }, { 3082: 'Cerrado' }] }],
  }],
  appShell: { areas: [{ label: 'Main', groups: [{ label: 'Records', subAreas: [{ entity: 'contoso_item', title: 'Items' }] }] }] },
};

const ran = (step, label) => {
  assert.ok(step, `${label} ran`);
  if (step.error) throw step.error;
  assert.deepEqual(step.unexpected, [], `every request ${label} sent is one the fake models`);
  return step;
};
const options = (org) => org.metadata.tables.get('contoso_item').Attributes.get('contoso_stage').OptionSet.Options;
const held = (org) => options(org).map((o) => o.Label.LocalizedLabels.map((l) => `${l.LanguageCode}:${l.Label}`).join(' '));

// The source with the column built, its second option relabelled as a maker can in the designer (Dataverse allows a label two options
// share), the spec a download of it writes, and what a fresh environment holds after a rebuild of that spec.
async function roundTrip(secondOption) {
  const org = createLifecycleOrg(LANGUAGES);
  const root = makeTempDir('option-label-language-');
  const harness = createLifecycleHarness(org, root);
  const build = ran(await harness.measure(() => harness.build(spec)), 'the source build');
  assert.equal(build.value.result.ok, true, JSON.stringify(build.value.result.errors));
  options(org)[1].Label = { LocalizedLabels: [{ Label: secondOption.text, LanguageCode: secondOption.lcid, IsManaged: false }], UserLocalizedLabel: null };
  const download = ran(await harness.measure(() => harness.download(appUniqueName(spec), path.join(root, 'download'))), 'the download');
  assert.equal(download.value.emitted.ok, true, JSON.stringify(download.value.emitted));
  const got = download.value.spec;
  assert.deepEqual(validateAppSpec(got, { profile: 'plan', reconstructed: true }).errors, []);
  const fresh = createLifecycleOrg(LANGUAGES);
  const target = createLifecycleHarness(fresh, path.join(root, 'fresh'));
  const rebuild = ran(await target.measure(() => target.build(got)), 'the fresh build');
  assert.equal(rebuild.value.result.ok, true, JSON.stringify(rebuild.value.result.errors));
  const column = got.entities[0].columns.find((c) => c.schemaName === 'contoso_stage');
  return { source: held(org), column, warnings: download.value.stderr.split('\n').filter((line) => line.startsWith('WARNING: ')), fresh: held(fresh) };
}

test('option label language: two options sharing their text in one language keep it through download and rebuild, and so does every other option', async () => {
  const trip = await roundTrip({ text: 'Ouvert', lcid: 1036 });
  assert.deepEqual(trip.source, ['1036:Ouvert', '1036:Ouvert', '3082:Cerrado']);
  assert.deepEqual(trip.column.options, [{ 1036: 'Ouvert' }, { 1036: 'Ouvert' }, { 3082: 'Cerrado' }]);
  assert.equal(trip.column.type, 'Choice');
  assert.deepEqual(trip.fresh, trip.source, 'a fresh environment holds each option in the language the source holds it in');
  assert.ok(trip.warnings.some((w) => /'Ouvert' names BOTH options\[0\] and options\[1\]/.test(w)), 'the duplicate is still reported');
  assert.equal(trip.warnings.some((w) => /could not be kept/.test(w)), false, 'no language is lost, and none is said to be');
});

test('option label language: two options sharing their text in different languages lose only their own language, and the download names each', async () => {
  const trip = await roundTrip({ text: 'Ouvert', lcid: 3082 });
  assert.deepEqual(trip.source, ['1036:Ouvert', '3082:Ouvert', '3082:Cerrado']);
  assert.deepEqual(trip.column.options, ['Ouvert', 'Ouvert', { 3082: 'Cerrado' }]);
  assert.equal(trip.column.type, 'Choice');
  assert.deepEqual(trip.fresh, ['1033:Ouvert', '1033:Ouvert', '3082:Cerrado'], 'the unrelated option keeps its language');
  const lost = trip.warnings.find((w) => /could not be kept/.test(w));
  assert.ok(lost, JSON.stringify(trip.warnings));
  assert.match(lost, /contoso_item\.contoso_stage options\[0\] 'Ouvert' \(1036\), contoso_item\.contoso_stage options\[1\] 'Ouvert' \(3082\)/);
  assert.doesNotMatch(lost, /Cerrado/);
});
