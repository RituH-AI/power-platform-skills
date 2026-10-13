#!/usr/bin/env node

// Collects read-only permission evidence from a traditional Power Pages PAC export.
// Supports both enhanced per-record metadata and standard-model aggregate files.
//
// Usage:
//   node collect-traditional-permission-evidence.js --projectRoot <path>
//
// Output:
//   JSON containing normalized roles, table permissions, page rules, native data
//   components, Web API settings, pages, and content references.

'use strict';

const fs = require('fs');
const path = require('path');
const { parseSimpleYaml } = require('../../../scripts/lib/powerpages-config');
const {
  findProjectRoot,
  resolvePowerPagesSiteRoot,
} = require('../../../scripts/lib/validation-helpers');

function getArg(name) {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
}

function toPosixRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function walkFiles(root, predicate) {
  const files = [];
  if (!root || !fs.existsSync(root)) {
    return files;
  }

  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(filePath);
      } else if (!predicate || predicate(filePath)) {
        files.push(filePath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function parseTopLevelSequence(content, filePath) {
  const records = [];
  let block = [];

  function flush() {
    if (block.length === 0) {
      return;
    }
    records.push(parseSimpleYaml(block.join('\n'), filePath));
    block = [];
  }

  // Standard-model PAC files serialize records as a top-level YAML sequence:
  //   - adx_name: Anonymous Users
  //     adx_webroleid: <uuid>
  //     adx_related_ids:
  //     - <uuid>
  // De-indent each record by two spaces while retaining deeper block-scalar
  // indentation. This lets the repository's zero-dependency scalar parser handle
  // each mapping without adding a second general-purpose YAML implementation.
  for (const rawLine of content.split(/\r?\n/)) {
    if (/^-\s+/.test(rawLine)) {
      flush();
      block.push(rawLine.replace(/^-\s+/, ''));
      continue;
    }
    if (block.length === 0) {
      if (rawLine.trim() !== '') {
        throw new Error(`Expected a top-level YAML sequence in ${filePath}`);
      }
      continue;
    }
    block.push(rawLine.startsWith('  ') ? rawLine.slice(2) : rawLine);
  }
  flush();
  return records;
}

function parseSingleFile(filePath, parseErrors) {
  try {
    return [parseSimpleYaml(fs.readFileSync(filePath, 'utf8'), filePath)];
  } catch (error) {
    parseErrors.push({
      filePath,
      message: error.message,
    });
    return [];
  }
}

function parseSequenceFile(filePath, parseErrors) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    return parseTopLevelSequence(fs.readFileSync(filePath, 'utf8'), filePath);
  } catch (error) {
    parseErrors.push({
      filePath,
      message: error.message,
    });
    return [];
  }
}

function parseFiles(files, parseErrors) {
  return files.flatMap(filePath => parseSingleFile(filePath, parseErrors));
}

function first(record, names, fallback = null) {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null && record[name] !== '') {
      return record[name];
    }
  }
  return fallback;
}

function booleanValue(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return null;
}

function arrayValue(value) {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [String(value)];
}

function normalizeRole(record, siteRoot, sourceFormat) {
  return {
    id: first(record, ['id', 'adx_webroleid']),
    name: first(record, ['name', 'adx_name']),
    anonymous: booleanValue(first(record, ['anonymoususersrole', 'adx_anonymoususersrole'])),
    authenticated: booleanValue(first(record, ['authenticatedusersrole', 'adx_authenticatedusersrole'])),
    sourceFormat,
    filePath: toPosixRelative(siteRoot, record.filePath),
  };
}

function normalizePermission(record, siteRoot) {
  const standard = Object.prototype.hasOwnProperty.call(record, 'adx_entitypermissionid')
    || Object.prototype.hasOwnProperty.call(record, 'adx_entitylogicalname');
  return {
    id: first(record, ['id', 'adx_entitypermissionid']),
    name: first(record, ['entityname', 'adx_entityname']),
    table: first(record, ['entitylogicalname', 'adx_entitylogicalname']),
    scope: first(record, ['scope', 'adx_scope']),
    read: booleanValue(first(record, ['read', 'adx_read'])),
    create: booleanValue(first(record, ['create', 'adx_create'])),
    write: booleanValue(first(record, ['write', 'adx_write'])),
    delete: booleanValue(first(record, ['delete', 'adx_delete'])),
    append: booleanValue(first(record, ['append', 'adx_append'])),
    appendTo: booleanValue(first(record, ['appendto', 'adx_appendto'])),
    roleIds: arrayValue(first(record, ['adx_entitypermission_webrole'], [])),
    contactRelationship: first(record, ['contactrelationship', 'adx_contactrelationship']),
    accountRelationship: first(record, ['accountrelationship', 'adx_accountrelationship']),
    parentPermissionId: first(record, ['parententitypermission', 'adx_parententitypermission']),
    parentRelationship: first(record, ['parentrelationship', 'adx_parentrelationship']),
    sourceFormat: standard ? 'standard' : 'enhanced',
    filePath: toPosixRelative(siteRoot, record.filePath),
  };
}

function normalizeSetting(record, siteRoot, sourceFormat) {
  return {
    id: first(record, ['id', 'adx_sitesettingid']),
    name: first(record, ['name', 'adx_name']),
    value: first(record, ['value', 'adx_value']),
    sourceFormat,
    filePath: toPosixRelative(siteRoot, record.filePath),
  };
}

function normalizePageRule(record, siteRoot, sourceFormat) {
  return {
    id: first(record, ['id', 'adx_webpageaccesscontrolruleid']),
    name: first(record, ['name', 'adx_name']),
    right: first(record, ['right', 'adx_right']),
    webpageId: first(record, ['webpageid', 'adx_webpageid']),
    roleIds: arrayValue(first(record, ['adx_webpageaccesscontrolrule_webrole'], [])),
    stateCode: first(record, ['statecode', 'adx_statecode'], null),
    statusCode: first(record, ['statuscode', 'adx_statuscode'], null),
    sourceFormat,
    filePath: toPosixRelative(siteRoot, record.filePath),
  };
}

function normalizeBasicForm(record, siteRoot) {
  return {
    id: first(record, ['id', 'adx_entityformid']),
    name: first(record, ['name', 'adx_name']),
    table: first(record, ['entityname', 'adx_entityname']),
    formName: first(record, ['formname', 'adx_formname']),
    mode: first(record, ['mode', 'adx_mode']),
    entityPermissionsEnabled: booleanValue(first(
      record,
      ['entitypermissionsenabled', 'adx_entitypermissionsenabled']
    )),
    filePath: toPosixRelative(siteRoot, record.filePath),
  };
}

function normalizeAdvancedFormStep(record, siteRoot) {
  return {
    id: first(record, ['id', 'adx_webformstepid']),
    name: first(record, ['name', 'adx_name']),
    advancedFormId: first(record, ['webform', 'adx_webform']),
    table: first(record, ['targetentitylogicalname', 'adx_targetentitylogicalname']),
    type: first(record, ['type', 'adx_type']),
    entityPermissionsEnabled: booleanValue(first(
      record,
      ['entitypermissionsenabled', 'adx_entitypermissionsenabled']
    )),
    filePath: toPosixRelative(siteRoot, record.filePath),
  };
}

function normalizeAdvancedForm(record, siteRoot) {
  return {
    id: first(record, ['id', 'adx_webformid']),
    name: first(record, ['name', 'adx_name']),
    startStepId: first(record, ['startstep', 'adx_startstep']),
    filePath: toPosixRelative(siteRoot, record.filePath),
  };
}

function normalizeList(record, siteRoot) {
  const settings = String(first(record, ['settings', 'adx_settings'], ''));
  return {
    id: first(record, ['id', 'adx_entitylistid']),
    name: first(record, ['name', 'adx_name']),
    table: first(record, ['entityname', 'adx_entityname']),
    entityPermissionsEnabled: booleanValue(first(
      record,
      ['entitypermissionsenabled', 'adx_entitypermissionsenabled']
    )),
    actions: {
      read: true,
      create: /CrmEntityFormView-CreateAction/i.test(settings),
      write: /CrmEntityFormView-EditAction/i.test(settings),
      delete: /CrmEntityFormView-DeleteAction/i.test(settings),
      details: /CrmEntityFormView-DetailsAction/i.test(settings),
    },
    filePath: toPosixRelative(siteRoot, record.filePath),
  };
}

function normalizePage(record, siteRoot) {
  return {
    id: first(record, ['id', 'adx_webpageid']),
    name: first(record, ['name', 'adx_name']),
    parentPageId: first(record, ['parentpageid', 'adx_parentpageid']),
    pageTemplateId: first(record, ['pagetemplateid', 'adx_pagetemplateid']),
    filePath: toPosixRelative(siteRoot, record.filePath),
  };
}

function uniqueMatches(content, regex) {
  const values = new Set();
  let match;
  while ((match = regex.exec(content)) !== null) {
    values.add(match[1]);
  }
  return [...values].sort((left, right) => left.localeCompare(right));
}

function collectContentEvidence(siteRoot) {
  const roots = [
    'web-pages',
    'web-templates',
    'page-templates',
    'content-snippets',
    'web-files',
  ];
  const files = roots.flatMap(relativeRoot =>
    walkFiles(path.join(siteRoot, relativeRoot), filePath =>
      !/\.(?:ya?ml|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|pdf|zip)$/i.test(filePath)
    )
  );

  return files.flatMap(filePath => {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      return [];
    }

    const evidence = {
      filePath: toPosixRelative(siteRoot, filePath),
      basicForms: uniqueMatches(
        content,
        /\{%\s*entityform\b[^%]*\bname\s*:\s*['"]([^'"]+)['"]/gi
      ),
      advancedForms: uniqueMatches(
        content,
        /\{%\s*webform\b[^%]*\bname\s*:\s*['"]([^'"]+)['"]/gi
      ),
      lists: uniqueMatches(
        content,
        /\{%\s*include\s+['"]entity_list['"][^%]*\bkey\s*:\s*['"]([^'"]+)['"]/gi
      ),
      includes: uniqueMatches(content, /\{%\s*include\s+['"]([^'"]+)['"]/gi),
      fetchXmlTables: uniqueMatches(content, /<entity\b[^>]*\bname\s*=\s*['"]([^'"]+)['"]/gi),
      linkedTables: uniqueMatches(content, /<link-entity\b[^>]*\bname\s*=\s*['"]([^'"]+)['"]/gi),
      liquidEntityTables: [
        ...uniqueMatches(content, /\bentities\s*\[\s*['"]([^'"]+)['"]\s*\]/gi),
        ...uniqueMatches(content, /\bentities\.([A-Za-z0-9_]+)/gi),
      ].filter((value, index, values) => values.indexOf(value) === index).sort(),
      webApiEntitySets: uniqueMatches(content, /\/_api\/([A-Za-z0-9_]+)/gi),
      httpMethods: uniqueMatches(
        content,
        /\bmethod\s*:\s*['"](GET|POST|PATCH|PUT|DELETE)['"]/gi
      ).map(value => value.toUpperCase()),
    };

    const hasEvidence = Object.entries(evidence)
      .some(([key, value]) => key !== 'filePath' && Array.isArray(value) && value.length > 0);
    return hasEvidence ? [evidence] : [];
  });
}

function attachReferences(records, evidence, evidenceKey) {
  const referencesByName = new Map();
  for (const item of evidence) {
    for (const name of item[evidenceKey] || []) {
      const key = String(name).toLowerCase();
      if (!referencesByName.has(key)) {
        referencesByName.set(key, []);
      }
      referencesByName.get(key).push(item.filePath);
    }
  }

  return records.map(record => ({
    ...record,
    referencedBy: record.name
      ? [...new Set(referencesByName.get(String(record.name).toLowerCase()) || [])]
      : [],
  }));
}

function collectEvidence(projectRootArg) {
  const discoveredProjectRoot = projectRootArg
    ? path.resolve(projectRootArg)
    : findProjectRoot(process.cwd());
  if (!discoveredProjectRoot) {
    throw new Error('No Power Pages project root was found.');
  }

  const siteRoot = resolvePowerPagesSiteRoot(discoveredProjectRoot);
  if (!siteRoot) {
    throw new Error(`No nested or direct PAC site root was found for ${discoveredProjectRoot}.`);
  }

  const parseErrors = [];

  const enhancedRoleFiles = walkFiles(
    path.join(siteRoot, 'web-roles'),
    filePath => /\.webrole\.ya?ml$/i.test(filePath)
  );
  const enhancedRoles = parseFiles(enhancedRoleFiles, parseErrors)
    .map(record => normalizeRole(record, siteRoot, 'enhanced'));
  const standardRoles = parseSequenceFile(path.join(siteRoot, 'webrole.yml'), parseErrors)
    .map(record => normalizeRole(record, siteRoot, 'standard'));

  const permissionFiles = walkFiles(
    path.join(siteRoot, 'table-permissions'),
    filePath => /\.tablepermission\.ya?ml$/i.test(filePath)
  );
  const permissions = parseFiles(permissionFiles, parseErrors)
    .map(record => normalizePermission(record, siteRoot));

  const enhancedSettingFiles = walkFiles(
    path.join(siteRoot, 'site-settings'),
    filePath => /\.sitesetting\.ya?ml$/i.test(filePath)
  );
  const enhancedSettings = parseFiles(enhancedSettingFiles, parseErrors)
    .map(record => normalizeSetting(record, siteRoot, 'enhanced'));
  const standardSettings = parseSequenceFile(path.join(siteRoot, 'sitesetting.yml'), parseErrors)
    .map(record => normalizeSetting(record, siteRoot, 'standard'));
  const settings = [...enhancedSettings, ...standardSettings];

  const enhancedPageRuleFiles = walkFiles(
    path.join(siteRoot, 'webpage-rules'),
    filePath => /\.webpagerule\.ya?ml$/i.test(filePath)
  );
  const enhancedPageRules = parseFiles(enhancedPageRuleFiles, parseErrors)
    .map(record => normalizePageRule(record, siteRoot, 'enhanced'));
  const standardPageRules = parseSequenceFile(path.join(siteRoot, 'webpagerule.yml'), parseErrors)
    .map(record => normalizePageRule(record, siteRoot, 'standard'));

  const basicForms = parseFiles(
    walkFiles(path.join(siteRoot, 'basic-forms'), filePath => /\.basicform\.ya?ml$/i.test(filePath)),
    parseErrors
  ).map(record => normalizeBasicForm(record, siteRoot));
  const advancedFormSteps = parseFiles(
    walkFiles(
      path.join(siteRoot, 'advanced-forms'),
      filePath => /\.advancedformstep\.ya?ml$/i.test(filePath)
    ),
    parseErrors
  ).map(record => normalizeAdvancedFormStep(record, siteRoot));
  const advancedForms = parseFiles(
    walkFiles(
      path.join(siteRoot, 'advanced-forms'),
      filePath => /\.advancedform\.ya?ml$/i.test(filePath)
    ),
    parseErrors
  ).map(record => normalizeAdvancedForm(record, siteRoot));
  const lists = parseFiles(
    walkFiles(path.join(siteRoot, 'lists'), filePath => /\.list\.ya?ml$/i.test(filePath)),
    parseErrors
  ).map(record => normalizeList(record, siteRoot));
  const pages = parseFiles(
    walkFiles(path.join(siteRoot, 'web-pages'), filePath => /\.webpage\.ya?ml$/i.test(filePath)),
    parseErrors
  ).map(record => normalizePage(record, siteRoot));

  const contentEvidence = collectContentEvidence(siteRoot);
  const roles = [...enhancedRoles, ...standardRoles];
  const pageRules = [...enhancedPageRules, ...standardPageRules];

  const observedFormats = new Set([
    ...roles.map(record => record.sourceFormat),
    ...permissions.map(record => record.sourceFormat),
    ...settings.map(record => record.sourceFormat),
    ...pageRules.map(record => record.sourceFormat),
  ]);
  const dataModelFormat = observedFormats.size === 0
    ? 'unknown'
    : observedFormats.size === 1
      ? [...observedFormats][0]
      : 'mixed';

  return {
    projectRoot: discoveredProjectRoot,
    siteRoot,
    dataModelFormat,
    parseErrors: parseErrors.map(error => ({
      filePath: toPosixRelative(siteRoot, error.filePath),
      message: error.message,
    })),
    roles,
    tablePermissions: permissions,
    pageRules,
    pages,
    basicForms: attachReferences(basicForms, contentEvidence, 'basicForms'),
    advancedForms: attachReferences(advancedForms, contentEvidence, 'advancedForms'),
    advancedFormSteps,
    lists: attachReferences(lists, contentEvidence, 'lists'),
    webApiSettings: settings.filter(setting =>
      /^Webapi\//i.test(String(setting.name || ''))
    ),
    contentEvidence,
  };
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(collectEvidence(getArg('projectRoot')), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  collectEvidence,
  parseTopLevelSequence,
};
