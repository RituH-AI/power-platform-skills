'use strict';
// Lookup discovery for the genpage planner (scripts/get-lookup-metadata.js): for each table a page reads, its lookup columns with
// their COMPLETE target sets and the concrete paths a page can filter a target through. It composes two existing readers and owns
// no HTTP of its own:
//   - the SDK's fetchEntityMetadata(table) — the source of each lookup's identity and complete `targets` (the SDK reads them from
//     the table's LookupAttributeMetadata cast), the table's primary id and name columns, and nothing guessed from a name;
//   - lib/relationship-metadata.js readRelationshipsOf(…, 'ManyToOne', cache, { lookupDetails: true }) — every page of the
//     table's ManyToOne relationships with the target key and the navigation property, which the SDK's projection drops. When the
//     SDK projects ReferencingAttribute and ReferencingEntityNavigationPropertyName on its relationship rows, that read can go.
//
// A path is CONCRETE — a target discriminator a page may filter through (`customerid_account/accountid eq <id>`) — only when one
// relationship of the lookup column reaches that target and its navigation property belongs to no other target. Anything else is
// a SHARED path, listed separately and never used to pick a target: Owner's `ownerid` (one navigation property, a relationship to
// the abstract `owner` table, which is in no lookup's targets), a navigation property two targets share, or a target reached twice.
// Nothing here manufactures a path (`ownerid_team`, `ownerid_systemuser`) or splits a navigation name on `_` to find a table.
//
// Every failure is a failure of the whole read — a missing table, a lookup without targets, a refused or malformed relationship page
// — so a caller never receives a shorter candidate list as if it were complete.

const { readRelationshipsOf } = require('./relationship-metadata.js');

// The attribute types that are lookups (AttributeTypeCode names, as the SDK projects them).
// https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/attributetypecode
const LOOKUP_TYPES = new Set(['Lookup', 'Customer', 'Owner']);
const LOGICAL_NAME = /^[a-z_][a-z0-9_]*$/;

function lookupError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * A table's lookups from its SDK metadata and its lookup-details relationship rows.
 * @param {object} metadata - fetchEntityMetadata's answer: { logicalName, primaryIdAttribute, primaryNameAttribute, attributes: [{ logicalName, attributeType, targets? }] }
 * @param {object[]} rows - readRelationshipsOf lookup-details rows: { schemaName, referencedEntity, referencingAttribute, referencedAttribute, navigationProperty }
 */
function tableLookups(metadata, rows) {
  const table = String(metadata.logicalName || '').toLowerCase();
  const attributes = Array.isArray(metadata.attributes) ? metadata.attributes : [];
  const lookups = [];
  for (const attribute of attributes) {
    if (!attribute || !LOOKUP_TYPES.has(attribute.attributeType)) continue;
    const column = String(attribute.logicalName || '').toLowerCase();
    const targets = Array.isArray(attribute.targets) ? attribute.targets.map((target) => String(target).toLowerCase()) : [];
    // The SDK fills `targets` from a separate cast read and leaves them out when that read fails, so a lookup without them is an
    // incomplete answer, never a lookup with no targets.
    if (!LOGICAL_NAME.test(column) || !targets.length || targets.some((target) => !LOGICAL_NAME.test(target))) {
      throw lookupError('LOOKUP_METADATA_INCOMPLETE', `${table}.${column || '?'}: the metadata read did not state the lookup's targets`);
    }
    const own = rows.filter((row) => String(row.referencingAttribute || '').toLowerCase() === column);
    const byNavigation = new Map();
    for (const row of own) byNavigation.set(row.navigationProperty, (byNavigation.get(row.navigationProperty) || 0) + 1);
    const paths = [];
    const sharedPaths = [];
    for (const row of own) {
      const target = String(row.referencedEntity || '').toLowerCase();
      const entry = { navigationProperty: row.navigationProperty, referencedKey: String(row.referencedAttribute || '').toLowerCase(), relationship: row.schemaName };
      const concrete = targets.includes(target)
        && own.filter((other) => String(other.referencedEntity || '').toLowerCase() === target).length === 1
        && byNavigation.get(row.navigationProperty) === 1;
      if (concrete) paths.push({ target, ...entry });
      else sharedPaths.push({ referencedEntity: target, ...entry });
    }
    const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    paths.sort((a, b) => byText(a.target, b.target));
    sharedPaths.sort((a, b) => byText(a.navigationProperty, b.navigationProperty) || byText(a.referencedEntity, b.referencedEntity));
    lookups.push({ column, readProperty: `_${column}_value`, attributeType: attribute.attributeType, targets, paths, sharedPaths });
  }
  lookups.sort((a, b) => (a.column < b.column ? -1 : a.column > b.column ? 1 : 0));
  return {
    logicalName: table,
    primaryIdAttribute: metadata.primaryIdAttribute || '',
    primaryNameAttribute: metadata.primaryNameAttribute || '',
    lookups,
  };
}

/**
 * Reads the lookups of `tables` through an SDK instance (its fetchEntityMetadata, and its `dataverse` client for the relationship read).
 * @param {object} sdk - a maker SDK instance
 * @param {string[]} tables - table logical names
 * @returns {Promise<{ ok: true, tables: object[] }>} - throws an Error with a `code` on any failure
 */
async function readLookupMetadata(sdk, tables) {
  if (!Array.isArray(tables) || !tables.length) throw lookupError('LOOKUP_TABLES_REQUIRED', 'name at least one table');
  const cache = new Map();
  const out = [];
  for (const name of tables) {
    const table = String(name).toLowerCase();
    if (!LOGICAL_NAME.test(table)) throw lookupError('LOOKUP_TABLE_NAME_INVALID', `'${name}' is not a table logical name`);
    const metadata = await sdk.fetchEntityMetadata(table);
    if (!metadata || String(metadata.logicalName || '').toLowerCase() !== table || !Array.isArray(metadata.attributes)) {
      throw lookupError('LOOKUP_METADATA_INCOMPLETE', `${table}: the metadata read did not answer for this table`);
    }
    const relationships = await readRelationshipsOf(sdk.dataverse, table, 'ManyToOne', cache, { lookupDetails: true });
    if (!relationships.ok) {
      throw lookupError(relationships.tableMissing ? 'LOOKUP_TABLE_NOT_FOUND' : 'LOOKUP_RELATIONSHIPS_UNREADABLE', `${table}: ${relationships.error}`);
    }
    out.push(tableLookups(metadata, relationships.rows));
  }
  return { ok: true, tables: out };
}

module.exports = { readLookupMetadata, tableLookups, LOOKUP_TYPES };
