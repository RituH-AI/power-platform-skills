'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildModel,
  localizePreviewImages,
  parseArgs,
  renderTemplateImportStatus,
} = require('../render-template-import-status');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'template-import-status-test-'));
}

test('parseArgs accepts import status page inputs', () => {
  assert.deepEqual(parseArgs([
    '--templateName', 'Supplier Portal',
    '--statusPath', '/tmp/status.json',
    '--outputPath', '/tmp/import.html',
    '--previewImagesJson', '["file:///tmp/a.png"]',
    '--solutionCount', '2',
    '--open',
  ]), {
    templateName: 'Supplier Portal',
    statusPath: '/tmp/status.json',
    outputPath: '/tmp/import.html',
    previewImages: ['file:///tmp/a.png'],
    solutionCount: 2,
    open: true,
  });
});

test('renderTemplateImportStatus renders the shared SPA and non-SPA provisioning UI', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outputPath = path.join(dir, 'import.html');
  const statusPath = path.join(dir, 'status.json');

  const result = renderTemplateImportStatus({
    templateName: 'Supplier Portal',
    statusPath,
    outputPath,
    previewImages: ['file:///tmp/a.png', 'file:///tmp/b.png'],
    solutionCount: 2,
  });
  const html = fs.readFileSync(outputPath, 'utf8');

  assert.deepEqual(result, { status: 'ok', output: outputPath, statusPath });
  assert.match(html, /class="shell"/);
  assert.match(html, /Your selected SPA template/);
  assert.match(html, /"templateCategory":"SPA"/);
  assert.equal(html.includes('file:///tmp/a.png'), true);
  assert.match(html, /"statusFeed":\{"url":"status\.json","intervalMs":1500\}/);
  assert.match(html, /preview-card/);
  assert.match(html, /Install supporting solutions/);
  assert.match(html, /Create SPA site/);
  assert.match(html, /Apply seed data/);
  assert.match(html, /Activate site/);
  assert.match(html, /pollStatusFeed/);
  assert.match(html, /Open website/);
  assert.match(html, /Template site is ready/);
  assert.match(html, /Template setup needs attention/);
  assert.doesNotMatch(html, /window\.location\.assign/);
  assert.doesNotMatch(html, /Git baseline/);
});

test('renderTemplateImportStatus uses singular solution copy for one solution', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outputPath = path.join(dir, 'import.html');
  const statusPath = path.join(dir, 'status.json');

  renderTemplateImportStatus({
    templateName: '311 Portal',
    statusPath,
    outputPath,
    solutionCount: 1,
  });
  const html = fs.readFileSync(outputPath, 'utf8');

  assert.match(html, /Install supporting solution/);
  assert.doesNotMatch(html, /Install supporting solutions/);
});

test('renderTemplateImportStatus rejects invalid solution counts', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(
    () => renderTemplateImportStatus({
      templateName: '311 Portal',
      statusPath: path.join(dir, 'status.json'),
      outputPath: path.join(dir, 'import.html'),
      solutionCount: 0,
    }),
    /positive integer/
  );
});

test('renderTemplateImportStatus does not print the shared renderTemplate status line', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outputPath = path.join(dir, 'import.html');
  const statusPath = path.join(dir, 'status.json');
  const originalLog = console.log;
  const logs = [];
  console.log = (value) => logs.push(value);
  t.after(() => { console.log = originalLog; });

  renderTemplateImportStatus({ templateName: 'Supplier Portal', statusPath, outputPath });

  assert.deepEqual(logs, []);
});

test('localizePreviewImages copies local preview images beside the served page', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sourcePath = path.join(dir, 'preview.png');
  const outputPath = path.join(dir, 'site', 'import.html');
  const imageBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('fake png payload'),
  ]);
  fs.writeFileSync(sourcePath, imageBytes);

  const localized = localizePreviewImages([sourcePath], outputPath);

  assert.deepEqual(localized, ['preview-images/preview-01.png']);
  assert.deepEqual(
    fs.readFileSync(path.join(dir, 'site', 'preview-images', 'preview-01.png')),
    imageBytes
  );
});

test('localizePreviewImages rejects non-images, directories, and symlinks', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outputPath = path.join(dir, 'site', 'import.html');
  const textPath = path.join(dir, 'secret.txt');
  const fakePngPath = path.join(dir, 'fake.png');
  const imagePath = path.join(dir, 'preview.png');
  const imageLink = path.join(dir, 'preview-link.png');
  fs.writeFileSync(textPath, 'secret');
  fs.writeFileSync(fakePngPath, 'not a png');
  fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const inputs = [textPath, fakePngPath, dir];
  try {
    fs.symlinkSync(imagePath, imageLink);
    inputs.push(imageLink);
  } catch (err) {
    if (err.code !== 'EPERM') throw err;
  }

  assert.deepEqual(
    localizePreviewImages(inputs, outputPath),
    []
  );
});

test('buildModel uses an Open website result instead of automatic redirect metadata', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const model = buildModel({
    templateName: 'Supplier Portal',
    statusPath: path.join(dir, 'status.json'),
    outputPath: path.join(dir, 'status.html'),
    previewImages: [],
    solutionCount: 1,
  });

  assert.equal(model.presentation.templateCategory, 'SPA');
  assert.equal(model.statusFeed.url, 'status.json');
  assert.equal(model.status.openWebsiteUrl, null);
  assert.deepEqual(model.timeline.map(([title]) => title), [
    'Install supporting solution',
    'Create SPA site',
    'Apply seed data',
    'Activate site',
  ]);
});
