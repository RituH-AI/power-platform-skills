const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildModel,
  renderStatusPage,
} = require('../../skills/create-site/scripts/render-declarative-status');

function options(overrides = {}) {
  return {
    output: path.join(os.tmpdir(), 'unused-declarative-status.html'),
    templateName: 'EventPortal',
    modelVersion: 'Enhanced',
    status: 'accepted',
    siteName: 'Contoso Events',
    subdomain: 'contoso-events',
    language: '1033',
    ...overrides,
  };
}

test('buildModel combines Event Portal metadata, embedded previews, and current status', () => {
  const model = buildModel(options());

  assert.equal(model.template.displayName, 'Event Portal');
  assert.match(model.brandIcon, /^data:image\/png;base64,/);
  assert.equal(model.template.previews.length, 3);
  assert.match(model.template.previews[0].desktop, /^data:image\/png;base64,/);
  assert.deepEqual(model.template.requirements, ['Customer Insights - Journeys license']);
  assert.equal(model.status.key, 'accepted');
  assert.equal(model.status.step, 0);
  assert.equal(model.status.activityState, 'working');
  assert.equal(model.status.terminal, false);
  assert.equal(model.status.notification, null);
  assert.equal(model.site.modelVersion, 'Enhanced');
  assert.equal(model.refresh, true);
});

test('buildModel renders Standard completion and model-mismatch details', () => {
  const ready = buildModel(options({ modelVersion: 'Standard', status: 'ready' }));
  assert.match(ready.status.result.message, /Standard model verified/);
  assert.equal(ready.status.activityState, 'complete');
  assert.equal(ready.status.terminal, true);
  assert.equal(ready.refresh, false);

  const mismatch = buildModel(
    options({
      modelVersion: 'Standard',
      actualModelVersion: 'Enhanced',
      status: 'model-mismatch',
    })
  );
  assert.match(mismatch.status.message, /Enhanced instead of Standard/);
  assert.equal(mismatch.status.activityState, 'failed');
  assert.equal(mismatch.status.terminal, true);
  assert.equal(mismatch.refresh, false);
});

test('buildModel represents user-input pauses without implying active processing', () => {
  const model = buildModel(
    options({
      status: 'registration',
      activityState: 'awaiting-input',
      requiredAction: 'Confirm the website record selected from PAC.',
      responseLocation: 'Return to the site creation conversation and provide your response.',
    }),
  );

  assert.equal(model.status.step, 2);
  assert.equal(model.status.activityState, 'awaiting-input');
  assert.equal(model.status.terminal, false);
  assert.equal(model.status.chip, 'Input needed');
  assert.deepEqual(model.status.notification, {
    title: 'Your input is needed',
    requiredAction: 'Confirm the website record selected from PAC.',
    responseLocation: 'Return to the site creation conversation and provide your response.',
  });
  assert.equal(model.refresh, true);
});

test('buildModel renders failed and canceled phases as terminal non-working states', () => {
  const failed = buildModel(
    options({ status: 'download', activityState: 'failed' }),
  );
  assert.equal(failed.status.activityState, 'failed');
  assert.equal(failed.status.chip, 'Creation stopped');
  assert.equal(failed.status.terminal, true);
  assert.equal(failed.refresh, false);

  const canceled = buildModel(
    options({ status: 'validation', activityState: 'canceled' }),
  );
  assert.equal(canceled.status.activityState, 'canceled');
  assert.equal(canceled.status.chip, 'Canceled');
  assert.equal(canceled.status.terminal, true);
  assert.equal(canceled.refresh, false);
});

test('buildModel embeds Starter Layout 1 previews and capabilities', () => {
  const model = buildModel(options({ templateName: 'StarterLayout1' }));

  assert.equal(model.template.displayName, 'Starter Layout 1');
  assert.equal(model.template.previews.length, 3);
  assert.deepEqual(
    model.template.capabilities,
    ['Home page', 'Subpages', 'Contact us', 'Search results'],
  );
  for (const preview of model.template.previews) {
    assert.match(preview.desktop, /^data:image\/png;base64,/);
    assert.match(preview.mobile, /^data:image\/png;base64,/);
  }
});

test('buildModel embeds the Blank page desktop and mobile previews', () => {
  const model = buildModel(options({ templateName: 'BlankPage', modelVersion: 'Standard' }));

  assert.equal(model.template.displayName, 'Blank page');
  assert.deepEqual(model.template.capabilities, ['Home page']);
  assert.equal(model.template.previews.length, 1);
  assert.match(model.template.previews[0].desktop, /^data:image\/png;base64,/);
  assert.match(model.template.previews[0].mobile, /^data:image\/png;base64,/);
});

test('renderStatusPage creates a standalone page and overwrites it as status advances', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-declarative-status-'));
  const output = path.join(tempDir, 'status.html');

  try {
    const first = renderStatusPage(options({ output }));
    const acceptedHtml = fs.readFileSync(output, 'utf8');
    assert.equal(first.creationStatus, 'accepted');
    assert.match(first.url, /^file:/);
    assert.match(acceptedHtml, /Event Portal/);
    assert.match(acceptedHtml, /Customer Insights - Journeys license/);
    assert.match(acceptedHtml, /data:image\/png;base64,/);
    assert.match(acceptedHtml, /id="brandIcon"/);
    assert.match(acceptedHtml, /"modelVersion":"Enhanced"/);
    assert.match(acceptedHtml, /working-indicator/);
    assert.match(acceptedHtml, /id="inputNotice"/);
    assert.match(acceptedHtml, /prefers-reduced-motion: reduce/);
    assert.match(acceptedHtml, />AI-generated content may be incorrect</);
    assert.doesNotMatch(acceptedHtml, /id="statusKicker"/);
    assert.doesNotMatch(acceptedHtml, /__JSON_MODEL__/);

    renderStatusPage(options({ output, status: 'ready' }));
    const readyHtml = fs.readFileSync(output, 'utf8');
    assert.match(readyHtml, /"key":"ready"/);
    assert.notEqual(readyHtml, acceptedHtml);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('renderStatusPage clears the input notification when processing resumes', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-declarative-status-resume-'));
  const output = path.join(tempDir, 'status.html');

  try {
    renderStatusPage(
      options({
        output,
        status: 'registration',
        activityState: 'awaiting-input',
        requiredAction: 'Confirm the website record.',
      }),
    );
    const waitingHtml = fs.readFileSync(output, 'utf8');
    assert.match(waitingHtml, /"activityState":"awaiting-input"/);
    assert.match(waitingHtml, /Confirm the website record\./);

    renderStatusPage(options({ output, status: 'registration' }));
    const resumedHtml = fs.readFileSync(output, 'utf8');
    assert.match(resumedHtml, /"activityState":"working"/);
    assert.match(resumedHtml, /"notification":null/);
    assert.doesNotMatch(resumedHtml, /Confirm the website record\./);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('renderStatusPage uses a stable temporary path when output is omitted', () => {
  const result = renderStatusPage(options({ output: undefined, subdomain: 'contoso-event-status-test' }));

  try {
    assert.match(
      result.output,
      /power-platform-skills[\\/]create-site[\\/]contoso-event-status-test[\\/]status\.html$/,
    );
    assert.ok(fs.existsSync(result.output));
  } finally {
    fs.rmSync(path.dirname(result.output), { recursive: true, force: true });
  }
});

test('buildModel rejects unknown templates and statuses', () => {
  assert.throws(
    () => buildModel(options({ templateName: 'UnknownTemplate' })),
    /Unsupported --templateName/,
  );
  assert.throws(
    () => buildModel(options({ status: 'invented' })),
    /Unsupported --status/,
  );
  assert.throws(
    () => buildModel(options({ modelVersion: 'Automatic' })),
    /must be Enhanced or Standard/,
  );
  assert.throws(
    () => buildModel(options({ activityState: 'paused' })),
    /Unsupported --activityState/,
  );
  assert.throws(
    () => buildModel(options({ activityState: 'awaiting-input' })),
    /--requiredAction is required/,
  );
  assert.throws(
    () => buildModel(options({ requiredAction: 'Choose a site.' })),
    /only valid with --activityState awaiting-input/,
  );
  assert.throws(
    () => buildModel(options({ status: 'ready', activityState: 'working' })),
    /cannot use --activityState working/,
  );
});
