'use strict';
// get-lookup-metadata.js over the REAL vendored SDK (lib/maker-sdk.js, the throwaway workspace) and a stub HTTP transport answering the
// raw Web API shapes: the SDK's own table metadata read (the main read, the attribute casts — LookupAttributeMetadata carries each
// lookup's Targets — and its own relationship reads), then the plugin's lookup-details ManyToOne read, paged with an absolute
// @odata.nextLink. A mock of the SDK would keep passing against a bundle whose projection no longer carried `targets`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readLookups } = require(path.join(__dirname, '..', 'get-lookup-metadata.js'));

const ENV = 'https://contoso.crm.dynamics.com';
const label = (text) => ({ UserLocalizedLabel: { Label: text }, LocalizedLabels: [{ Label: text, LanguageCode: 1033 }] });
const ATTRIBUTES = [
  { LogicalName: 'opportunityid', AttributeType: 'Uniqueidentifier', AttributeTypeName: { Value: 'UniqueidentifierType' } },
  { LogicalName: 'name', AttributeType: 'String', AttributeTypeName: { Value: 'StringType' } },
  { LogicalName: 'customerid', AttributeType: 'Customer', AttributeTypeName: { Value: 'CustomerType' } },
  { LogicalName: 'ownerid', AttributeType: 'Owner', AttributeTypeName: { Value: 'OwnerType' } },
].map((a) => ({ DisplayName: label(a.LogicalName), Description: label(''), IsCustomAttribute: false, IsValidForUpdate: true, IsValidForRead: true, AttributeOf: null, ...a }));
const TARGETS = [{ LogicalName: 'customerid', Targets: ['account', 'contact'] }, { LogicalName: 'ownerid', Targets: ['systemuser', 'team'] }];
const DETAILS = 'SchemaName,ReferencedEntity,ReferencingAttribute,ReferencedAttribute,ReferencingEntityNavigationPropertyName';
const NEXT = `${ENV}/api/data/v9.2/EntityDefinitions(LogicalName='opportunity')/ManyToOneRelationships?$select=${DETAILS}&$skiptoken=page2`;

function transport({ lookupTargets = TARGETS, secondPage = { status: 200, body: { value: [
  { SchemaName: 'opportunity_customer_contacts', ReferencedEntity: 'contact', ReferencingAttribute: 'customerid', ReferencedAttribute: 'contactid', ReferencingEntityNavigationPropertyName: 'customerid_contact' },
  { SchemaName: 'owner_opportunitys', ReferencedEntity: 'owner', ReferencingAttribute: 'ownerid', ReferencedAttribute: 'ownerid', ReferencingEntityNavigationPropertyName: 'ownerid' },
] } } } = {}) {
  const reads = [];
  const answer = (url) => {
    const u = decodeURIComponent(url);
    reads.push(u);
    if (u === decodeURIComponent(NEXT)) return secondPage;
    const route = /\/api\/data\/v9\.\d\/EntityDefinitions\(LogicalName='([^']+)'\)(\/[^?]*)?(?:\?(.*))?$/.exec(u);
    if (!route) return { status: 404, headers: {}, body: { error: { code: '0x80060888', message: `no route for ${u}` } } };
    const [, table, sub = '', query = ''] = route;
    if (table !== 'opportunity') return { status: 404, headers: {}, body: { error: { code: '0x80060888', message: `Could not find entity ${table}` } } };
    if (sub === '') {
      return { status: 200, headers: {}, body: {
        LogicalName: 'opportunity', SchemaName: 'Opportunity', DisplayName: label('Opportunity'), Description: label(''), EntitySetName: 'opportunities',
        IsCustomEntity: false, PrimaryNameAttribute: 'name', PrimaryIdAttribute: 'opportunityid', PrimaryImageAttribute: null, Attributes: ATTRIBUTES,
      } };
    }
    if (sub === '/Attributes/Microsoft.Dynamics.CRM.LookupAttributeMetadata') return lookupTargets instanceof Object && !Array.isArray(lookupTargets) ? lookupTargets : { status: 200, headers: {}, body: { value: lookupTargets } };
    if (sub === '/ManyToOneRelationships' && query.includes('ReferencingEntityNavigationPropertyName')) {
      return { status: 200, headers: {}, body: { value: [
        { SchemaName: 'opportunity_customer_accounts', ReferencedEntity: 'account', ReferencingAttribute: 'customerid', ReferencedAttribute: 'accountid', ReferencingEntityNavigationPropertyName: 'customerid_account' },
      ], '@odata.nextLink': NEXT } };
    }
    return { status: 200, headers: {}, body: { value: [] } };
  };
  return {
    reads,
    get: async (url) => answer(url),
    post: async () => ({ status: 204, headers: {}, body: {} }),
    patch: async () => ({ status: 204, headers: {}, body: {} }),
    delete: async () => ({ status: 204, headers: {}, body: {} }),
  };
}

test('REAL BUNDLE: the complete targets from the SDK\'s metadata read, the concrete paths from every page of the lookup-details read', async () => {
  const http = transport();
  const answer = await readLookups(ENV, { tables: ['opportunity'] }, http);
  assert.equal(answer.ok, true);
  const [table] = answer.tables;
  assert.equal(table.primaryIdAttribute, 'opportunityid');
  assert.equal(table.primaryNameAttribute, 'name');
  const customer = table.lookups.find((lookup) => lookup.column === 'customerid');
  assert.deepEqual(customer.targets, ['account', 'contact']);
  assert.deepEqual(customer.paths.map((entry) => [entry.target, entry.navigationProperty, entry.referencedKey]), [['account', 'customerid_account', 'accountid'], ['contact', 'customerid_contact', 'contactid']]);
  const owner = table.lookups.find((lookup) => lookup.column === 'ownerid');
  assert.deepEqual(owner.targets, ['systemuser', 'team']);
  assert.deepEqual(owner.paths, []);
  assert.deepEqual(owner.sharedPaths.map((entry) => entry.navigationProperty), ['ownerid']);
  assert.ok(http.reads.includes(decodeURIComponent(NEXT)), 'the second page was followed, through the absolute link');
  assert.ok(!http.reads.some((u) => /ManyToOneRelationships/.test(u) && /DisplayName|LocalizedLabels/.test(u.split('?')[1] || '')), 'the relationship reads are label-free');
});

test('REAL BUNDLE: a refused targets read, a refused second page, or a missing table fails the whole discovery', async () => {
  for (const [label, options, tables, code] of [
    ['the SDK\'s targets read refused', { lookupTargets: { status: 503, headers: {}, body: { error: { code: '0x80040216', message: 'Service unavailable.' } } } }, ['opportunity'], 'LOOKUP_METADATA_INCOMPLETE'],
    ['the second relationship page refused', { secondPage: { status: 503, headers: {}, body: { error: { code: '0x80040216', message: 'Service unavailable.' } } } }, ['opportunity'], 'LOOKUP_RELATIONSHIPS_UNREADABLE'],
    ['a table the environment does not have', {}, ['nosuch'], null],
  ]) {
    await assert.rejects(readLookups(ENV, { tables }, transport(options)), (err) => (code ? err.code === code : typeof err.code === 'string' && err.code.length > 0), label);
  }
});
