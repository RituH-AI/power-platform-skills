#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  renderTemplate,
  parseArgs,
} = require('../../../scripts/lib/render-template');
const {
  normalizeDeclarativeModelVersion,
} = require('../../../scripts/lib/site-templates');
const {
  loadTraditionalTemplatePresentation,
} = require('../../../scripts/lib/traditional-template-catalog');

const ACTIVITY_STATES = new Set(['working', 'awaiting-input', 'failed', 'canceled']);

const STATUSES = Object.freeze({
  accepted: {
    step: 0,
    chip: 'Request accepted',
    title: 'Creation request accepted',
    message:
      'Power Pages accepted the request. No action is required while the platform prepares the site.',
  },
  provisioning: {
    step: 1,
    chip: 'Provisioning',
    title: 'Provisioning the selected template',
    message: 'The asynchronous creation operation is assembling the platform-managed components.',
  },
  registration: {
    step: 2,
    chip: 'Registering',
    title: 'Waiting for the website record',
    message: 'Provisioning completed. The website is still propagating to Dataverse and PAC.',
  },
  verification: {
    step: 3,
    chip: 'Verifying',
    title: 'Verifying the selected data model',
    message: 'The website record is available. PAC is confirming that the expected model was created.',
  },
  download: {
    step: 4,
    chip: 'Downloading',
    title: 'Downloading your site',
    message: 'The site is ready for PAC. Its declarative pages, forms, navigation, and settings are downloading.',
  },
  validation: {
    step: 5,
    chip: 'Validating',
    title: 'Validating the downloaded baseline',
    message: 'The downloaded identity, declarative assets, and project structure are being checked.',
  },
  git: {
    step: 6,
    chip: 'Saving baseline',
    title: 'Saving a clean starting point',
    message: 'The validated template is being recorded as the initial Git baseline.',
  },
  ready: {
    step: 7,
    chip: 'Ready',
    title: 'Your site is ready',
    message: 'The downloaded baseline and cloud site are ready for customization.',
    terminal: true,
    result: {
      title: 'Creation complete',
      message: 'Data model verified · Site downloaded · Validation passed · Git baseline created',
    },
  },
  'model-mismatch': {
    step: 3,
    chip: 'Action required',
    title: 'The site was created with a different data model',
    message: 'PAC reports a different model than selected. The cloud site is preserved, but download stopped to prevent using the wrong model.',
    terminal: true,
    error: true,
    result: {
      title: 'No duplicate site will be created',
      message: 'Review the environment setting, keep the existing website record, and resume verification later.',
    },
  },
});

const TIMELINE = Object.freeze([
  ['Request accepted', 'The platform returned 202 Accepted'],
  ['Template provisioning', 'The asynchronous operation is running'],
  ['Website registration', 'Waiting for the service-assigned website ID'],
  ['Data model verification', 'Checking the site with PAC'],
  ['Template download', 'Downloading traditional site assets'],
  ['Local validation', 'Checking identity, assets, and project structure'],
  ['Git baseline', 'Saving the downloaded starting point'],
]);

function toDataUrl(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = extension === '.png' ? 'image/png' : 'application/octet-stream';
  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function validateWebsiteUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('--siteUrl must be a valid absolute URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('--siteUrl must use HTTPS without embedded credentials');
  }
  return url.href;
}

function buildModel(options, template) {
  const modelVersion = normalizeDeclarativeModelVersion(options.modelVersion);
  const actualModelVersion = options.actualModelVersion
    ? normalizeDeclarativeModelVersion(options.actualModelVersion)
    : null;
  if (!template || template.name !== options.templateName) {
    throw new Error(`Catalog metadata does not match --templateName: ${options.templateName}`);
  }

  const status = STATUSES[options.status];
  if (!status) {
    throw new Error(`Unsupported --status: ${options.status}`);
  }
  const explicitSiteUrl = options.siteUrl ? validateWebsiteUrl(options.siteUrl) : null;
  if (options.status === 'ready' && !explicitSiteUrl) {
    throw new Error('--siteUrl is required when --status is ready');
  }
  const resolvedStatus = {
    ...status,
    message:
      options.status === 'model-mismatch'
        ? `PAC reports ${actualModelVersion || 'a different model'} instead of ` +
          `${modelVersion}. The cloud site is preserved, but download stopped to prevent using ` +
          'the wrong model.'
        : status.message,
    result: status.result
      ? {
          ...status.result,
          message:
            options.status === 'ready'
              ? `${modelVersion} model verified · Site downloaded · Validation passed · ` +
                'Git baseline created'
              : status.result.message,
        }
      : undefined,
  };
  const defaultActivityState =
    options.status === 'ready' ? 'complete' : status.error ? 'failed' : 'working';
  const activityState = options.activityState || defaultActivityState;
  if (
    activityState !== 'complete' &&
    !ACTIVITY_STATES.has(activityState)
  ) {
    throw new Error(
      `Unsupported --activityState: ${activityState}. ` +
        'Use working, awaiting-input, failed, or canceled.',
    );
  }
  if (activityState === 'complete' && options.activityState) {
    throw new Error('--activityState complete is derived from --status ready and cannot be set directly');
  }
  if (status.terminal && activityState === 'working') {
    throw new Error(`--status ${options.status} cannot use --activityState working`);
  }
  if (activityState === 'awaiting-input' && !String(options.requiredAction || '').trim()) {
    throw new Error('--requiredAction is required when --activityState is awaiting-input');
  }
  if (
    activityState !== 'awaiting-input' &&
    (options.requiredAction || options.responseLocation)
  ) {
    throw new Error(
      '--requiredAction and --responseLocation are only valid with --activityState awaiting-input',
    );
  }

  const awaitingInput = activityState === 'awaiting-input';
  const failed = activityState === 'failed';
  const canceled = activityState === 'canceled';
  const terminal = !awaitingInput && (status.terminal || failed || canceled);
  const activityChip = awaitingInput
    ? 'Input needed'
    : failed
      ? 'Creation stopped'
      : canceled
        ? 'Canceled'
        : resolvedStatus.chip;

  const pluginRoot = path.resolve(__dirname, '..', '..', '..');
  const brandIcon = toDataUrl(
    path.join(pluginRoot, 'skills', 'create-site', 'assets', 'shared', 'power-pages-icon.png'),
  );
  return {
    brandIcon,
    template: {
      name: template.name,
      displayName: template.displayName,
      description: template.description,
      capabilities: template.capabilities || [],
      requirements: template.requirements || [],
      warning: template.warning || '',
      previews: template.previews || [],
      catalog: template.catalog,
    },
    site: {
      name: options.siteName,
      url: explicitSiteUrl || `https://${options.subdomain}.powerappsportals.com`,
      language: options.language || '1033',
      websiteRecordId: options.websiteRecordId || '',
      modelVersion,
    },
    status: {
      key: options.status,
      ...resolvedStatus,
      chip: activityChip,
      activityState,
      terminal,
      openWebsiteUrl: options.status === 'ready' ? explicitSiteUrl : null,
      notification: awaitingInput
        ? {
            title: 'Your input is needed',
            requiredAction: String(options.requiredAction).trim(),
            responseLocation:
              String(options.responseLocation || '').trim() ||
              'Return to the site creation conversation and provide your response.',
          }
        : null,
    },
    timeline: TIMELINE,
    refresh: !terminal,
  };
}

async function renderStatusPage(options, deps = {}) {
  if (
    !options.templateName ||
    !options.catalogOwner ||
    !options.catalogRepo ||
    !options.catalogSha ||
    !options.modelVersion ||
    !options.status ||
    !options.siteName ||
    !options.subdomain
  ) {
    throw new Error(
      'Usage: render-declarative-status.js [--output <path>] --templateName <name> ' +
      '--catalogOwner <owner> --catalogRepo <repo> --catalogSha <sha> ' +
      '--modelVersion <Enhanced|Standard> --status <status> ' +
      '--siteName <name> --subdomain <subdomain> [--siteUrl <url>] [--language <lcid>] ' +
      '[--websiteRecordId <guid>] [--actualModelVersion <Enhanced|Standard>] ' +
      '[--activityState <working|awaiting-input|failed|canceled>] ' +
      '[--requiredAction <text>] [--responseLocation <text>]',
    );
  }

  const outputPath = options.output
    ? path.resolve(options.output)
    : path.join(
        os.tmpdir(),
        'power-platform-skills',
        'create-site',
        options.subdomain.replace(/[^a-z0-9-]/gi, '-'),
        'status.html',
      );
  const loadTemplate = deps.loadTraditionalTemplatePresentation ||
    loadTraditionalTemplatePresentation;
  const template = await loadTemplate({
    owner: options.catalogOwner,
    repo: options.catalogRepo,
    sha: options.catalogSha,
    templateName: options.templateName,
    cacheRoot: options.cacheRoot,
  }, deps);
  const model = buildModel(options, template);
  renderTemplate({
    templatePath: path.join(__dirname, '..', 'assets', 'declarative-creation-status-template.html'),
    outputPath,
    dataObject: { MODEL: model },
    requiredKeys: ['MODEL'],
    overwrite: true,
    emitStatus: false,
  });

  return {
    status: 'ok',
    output: outputPath,
    url: pathToFileURL(outputPath).href,
    creationStatus: options.status,
  };
}

async function main() {
  try {
    const result = await renderStatusPage(parseArgs(process.argv));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ACTIVITY_STATES,
  STATUSES,
  TIMELINE,
  buildModel,
  renderStatusPage,
  validateWebsiteUrl,
};
