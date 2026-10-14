'use strict';

const fs = require('fs');
const path = require('path');
const { parseSimpleYaml } = require('./powerpages-config');
const { resolvePowerPagesSiteRoot } = require('./validation-helpers');

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

  // PAC aggregate files are top-level sequences. Each record starts at column
  // zero while its mapping fields are indented by two spaces:
  //   - adx_name: Members
  //     adx_webroleid: <uuid>
  //     adx_related_ids:
  //     - <uuid>
  // De-indent one record at a time so the repository's scalar parser remains
  // the single implementation for values, arrays, and block scalars.
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

function loadAggregateRecords(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  return parseTopLevelSequence(fs.readFileSync(filePath, 'utf8'), filePath);
}

function needsQuoting(value) {
  if (typeof value !== 'string') {
    return false;
  }
  if (value === '' || value === 'true' || value === 'false' || value === 'null') {
    return true;
  }
  if (value !== value.trim() || /^-?\d+(?:\.\d+)?$/.test(value)) {
    return true;
  }
  if (/[:#{}[\],&*?|<>=!%@`]/.test(value)) {
    return true;
  }
  return /^[-'"\t]/.test(value);
}

function yamlValue(value) {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  if (needsQuoting(value)) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return String(value);
}

function renderAggregateRecord(fields, keyOrder) {
  const keys = keyOrder.filter(key => Object.prototype.hasOwnProperty.call(fields, key));
  const remaining = Object.keys(fields)
    .filter(key => !keys.includes(key))
    .sort();
  const orderedKeys = [...keys, ...remaining];
  const lines = [];

  for (const key of orderedKeys) {
    const value = fields[key];
    const prefix = lines.length === 0 ? '- ' : '  ';
    if (Array.isArray(value)) {
      lines.push(`${prefix}${key}:`);
      for (const item of value) {
        lines.push(`  - ${yamlValue(item)}`);
      }
    } else {
      lines.push(`${prefix}${key}: ${yamlValue(value)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function appendAggregateRecord(filePath, fields, keyOrder) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  if (current.trim() !== '') {
    // Refuse to append to malformed content. A blind append could make PAC accept
    // the new record while silently retaining an unreadable existing record.
    parseTopLevelSequence(current, filePath);
  }

  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const separator = current.length === 0 || current.endsWith('\n') ? '' : eol;
  const record = renderAggregateRecord(fields, keyOrder).replace(/\n/g, eol);
  const next = `${current}${separator}${record}`;
  const temporaryPath = `${filePath}.${process.pid}.tmp`;

  fs.writeFileSync(temporaryPath, next, 'utf8');
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // The original write error is more useful than cleanup failure.
    }
    throw error;
  }
}

function yamlFiles(dirPath, suffixPattern) {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return [];
  }
  return fs.readdirSync(dirPath)
    .filter(fileName => suffixPattern.test(fileName))
    .map(fileName => path.join(dirPath, fileName));
}

function storageMode(aggregateFile, perRecordFiles, perRecordDir) {
  const hasAggregate = fs.existsSync(aggregateFile);
  const hasPerRecord = perRecordFiles.length > 0;
  if (hasAggregate && hasPerRecord) {
    return 'mixed';
  }
  if (hasAggregate) {
    return 'aggregate';
  }
  if (hasPerRecord || fs.existsSync(perRecordDir)) {
    return 'per-record';
  }
  return 'missing';
}

function detectMetadataLayout(projectRoot) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const siteRoot = resolvePowerPagesSiteRoot(resolvedProjectRoot);
  if (!siteRoot) {
    throw new Error(`No Power Pages metadata root found for ${resolvedProjectRoot}.`);
  }

  const siteType = fs.existsSync(path.join(resolvedProjectRoot, 'powerpages.config.json'))
    ? 'code'
    : 'declarative';
  const webRolesDir = path.join(siteRoot, 'web-roles');
  const siteSettingsDir = path.join(siteRoot, 'site-settings');
  const roleAggregateFile = path.join(siteRoot, 'webrole.yml');
  const settingAggregateFile = path.join(siteRoot, 'sitesetting.yml');
  const roleFiles = yamlFiles(webRolesDir, /\.webrole\.ya?ml$/i);
  const settingFiles = yamlFiles(siteSettingsDir, /\.sitesetting\.ya?ml$/i);

  return {
    projectRoot: resolvedProjectRoot,
    siteRoot,
    siteType,
    roles: {
      mode: storageMode(roleAggregateFile, roleFiles, webRolesDir),
      aggregateFile: roleAggregateFile,
      directory: webRolesDir,
      files: roleFiles,
    },
    settings: {
      mode: storageMode(settingAggregateFile, settingFiles, siteSettingsDir),
      aggregateFile: settingAggregateFile,
      directory: siteSettingsDir,
      files: settingFiles,
    },
    tablePermissions: {
      directory: path.join(siteRoot, 'table-permissions'),
      fieldFormat: siteType === 'declarative' ? 'adx' : 'normalized',
    },
  };
}

function first(record, keys, fallback = null) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
      return record[key];
    }
  }
  return fallback;
}

function normalizeWebRole(record) {
  return {
    id: first(record, ['id', 'adx_webroleid']),
    name: first(record, ['name', 'adx_name']),
    anonymoususersrole: first(record, ['anonymoususersrole', 'adx_anonymoususersrole']),
    authenticatedusersrole: first(record, ['authenticatedusersrole', 'adx_authenticatedusersrole']),
    filePath: record.filePath,
  };
}

function normalizeSiteSetting(record) {
  const normalized = {
    id: first(record, ['id', 'adx_sitesettingid']),
    name: first(record, ['name', 'adx_name']),
    filePath: record.filePath,
  };
  const optionalFields = {
    value: ['value', 'adx_value'],
    description: ['description', 'adx_description'],
    source: ['source', 'adx_source'],
    envvar_schema: ['envvar_schema', 'adx_envvar_schema'],
  };
  for (const [target, keys] of Object.entries(optionalFields)) {
    const value = first(record, keys);
    if (value !== null) {
      normalized[target] = value;
    }
  }
  return normalized;
}

function normalizeTablePermission(record) {
  const normalized = { filePath: record.filePath };
  const fields = {
    adx_entitypermission_webrole: ['adx_entitypermission_webrole'],
    append: ['append', 'adx_append'],
    appendto: ['appendto', 'adx_appendto'],
    create: ['create', 'adx_create'],
    delete: ['delete', 'adx_delete'],
    entitylogicalname: ['entitylogicalname', 'adx_entitylogicalname'],
    entityname: ['entityname', 'adx_entityname'],
    id: ['id', 'adx_entitypermissionid'],
    read: ['read', 'adx_read'],
    scope: ['scope', 'adx_scope'],
    write: ['write', 'adx_write'],
  };
  for (const [target, keys] of Object.entries(fields)) {
    const value = first(record, keys);
    if (value !== null) {
      normalized[target] = value;
    }
  }
  const optionalFields = {
    accountrelationship: ['accountrelationship', 'adx_accountrelationship'],
    contactrelationship: ['contactrelationship', 'adx_contactrelationship'],
    parententitypermission: ['parententitypermission', 'adx_parententitypermission'],
    parentrelationship: ['parentrelationship', 'adx_parentrelationship'],
  };
  for (const [target, keys] of Object.entries(optionalFields)) {
    const value = first(record, keys);
    if (value !== null) {
      normalized[target] = value;
    }
  }
  return normalized;
}

module.exports = {
  appendAggregateRecord,
  detectMetadataLayout,
  loadAggregateRecords,
  normalizeSiteSetting,
  normalizeTablePermission,
  normalizeWebRole,
  parseTopLevelSequence,
  renderAggregateRecord,
  yamlValue,
};
