'use strict';
// The page error contract's evaluator (lib/page-error-evidence.js): one finite, fail-closed source grammar for "every
// supported dataApi failure goes through reportPageError, its view reaches rendered state, and the page renders inside
// PageErrorBoundary". The positive controls are COMPLETE pages assembled around the canonical block references/rules.md
// publishes ("Missing Error Handling"), so the evaluator, the published code and the existing graders cannot drift apart:
// the Custom API Action and the two-level built-in operations also pass runtimeProblems and builtInRuntimeProblems
// unchanged, through the boundary wrapper. Each negative control is one change to a positive page and names the problem
// it must produce. The old file-wide try/catch assertion is pinned beside them: it passes pages the grammar refuses.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const evidence = require('../lib/page-error-evidence.js');
const { pageErrorProblems, telemetrySafeSpans, gradePageErrors, pageErrorFingerprint, exemption, PAGE_ERROR_ASSERTION, LISTED_METHODS } = evidence;
const { runtimeProblems } = require('../lib/custom-api-contract.js');
const { builtInRuntimeProblems } = require('../lib/action-binding-union.js');
const { ASSERTIONS } = require('../lib/assertions-layer-2.js');
const { nestedDefinitionProblems } = require('../lib/tsx-structure.js');
const { pageStructureProblems } = require('../../../../plugins/model-apps/scripts/lib/page-structure.js');
const { getDataverseOperationCatalogue } = require('../../../../plugins/model-apps/scripts/lib/dataverse-operations.js');

const RULES = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'plugins', 'model-apps', 'references', 'rules.md'), 'utf8').replace(/\r\n/g, '\n');
const SECTION = RULES.slice(RULES.indexOf('\n### 2. Missing Error Handling\n'), RULES.indexOf('\n### 3. '));
const BLOCKS = [...SECTION.matchAll(/```tsx\n([\s\S]*?)\n```/g)].map((match) => match[1]);
const FOUNDATION = BLOCKS.find((block) => /\bfunction reportPageError\(/.test(block));
const TELEMETRY = BLOCKS.find((block) => /appInsights\?\.trackException\?\.\(/.test(block));
assert.ok(FOUNDATION && TELEMETRY, 'rules.md publishes the canonical page error block and its telemetry insertion');

// A complete page: the canonical block with its PageBody replaced, and top-level declarations added before it.
const BODY_AT = FOUNDATION.indexOf('function PageBody(');
const WRAPPER_AT = FOUNDATION.indexOf('const GeneratedComponent = ');
const page = (body, extra = '') => `${FOUNDATION.slice(0, BODY_AT)}${extra}${body}\n\n${FOUNDATION.slice(WRAPPER_AT)}`;
// One textual change; a change that does not apply is a broken test, never a pass.
function swap(source, from, to) {
  assert.ok(source.includes(from), `the page holds: ${from}`);
  return source.split(from).join(to);
}
const problems = (source) => pageErrorProblems(source);
function refused(source, reason, label) {
  const found = problems(source);
  assert.ok(found.some((problem) => reason.test(problem)), `${label}: expected ${reason}, got ${JSON.stringify(found)}`);
}
const OLD_TRY_CATCH = ASSERTIONS.get('Generated .tsx wraps async `dataApi` calls in try-catch (Dataverse pages only)');
const oldVerdict = (source) => OLD_TRY_CATCH({ files: [{ path: '/fake/new-page/page.tsx', name: 'page.tsx', content: source }], eval: { id: 99 } }).status;

// ---------- positive pages ----------

const CACHE_LIST = page(`function PageBody(props: GeneratedComponentProps) {
  const { dataApi } = props;
  const dataReady = !!dataApi;
  const [reloadKey, setReloadKey] = React.useState(0);
  const [{ rows, loading, error }, setData] = React.useState<{ rows: AccountRow[]; loading: boolean; error: PageErrorView | null }>(() => {
    const cached = winAny[CACHE_KEY] as AccountRow[] | undefined;
    return { rows: cached ?? [], loading: cached === undefined, error: null };
  });

  function retryLoad() {
    delete winAny[CACHE_KEY];
    delete winAny[INFLIGHT_KEY];
    setReloadKey((key) => key + 1);
  }

  React.useEffect(() => {
    if (!dataReady) return;
    const cached = winAny[CACHE_KEY] as AccountRow[] | undefined;
    if (cached !== undefined) {
      if (rows !== cached) setData({ rows: cached, loading: false, error: null });
      return;
    }
    let cancelled = false;
    let inflight = winAny[INFLIGHT_KEY] as Promise<AccountRow[]> | undefined;
    if (!inflight) {
      inflight = dataApi
        .queryTable<AccountRow>('account', { select: ['accountid', 'name'] })
        .then((result: { rows: AccountRow[] }) => {
          winAny[CACHE_KEY] = result.rows;
          return result.rows;
        })
        .finally(() => { if (winAny[INFLIGHT_KEY] === inflight) delete winAny[INFLIGHT_KEY]; });
      winAny[INFLIGHT_KEY] = inflight;
    }
    inflight
      .then((loaded) => { if (!cancelled) setData({ rows: loaded, loading: false, error: null }); })
      .catch((failure) => { if (!cancelled) setData({ rows: [], loading: false, error: reportPageError(PAGE_NAME, 'loadAccounts', undefined, failure, 'read', retryLoad) }); });
    return () => { cancelled = true; };
  }, [dataReady, reloadKey]);

  return (
    <div>
      <PageErrorBar error={error} />
      {loading ? <Spinner /> : rows.map((row) => <Text key={row.accountid}>{row.name}</Text>)}
    </div>
  );
}`, `type AccountRow = { accountid: string; name: string };
const winAny = window as any;
const CACHE_KEY = '__ppAccountOverview_accountCache';
const INFLIGHT_KEY = '__ppAccountOverview_accountInflight';

`);

const CACHE_RECORD = page(`function PageBody(props: GeneratedComponentProps) {
  const { dataApi, pageInput } = props;
  const recordId = pageInput?.recordId as string | undefined;
  const dataReady = !!dataApi && !!recordId;
  const [{ record, loading, error }, setData] = React.useState<{ record: AccountRecord | null; loading: boolean; error: PageErrorView | null }>({ record: null, loading: !!recordId, error: null });

  React.useEffect(() => {
    if (!dataReady) return;
    const id = recordId as string;
    const hit = recordCache.get(id);
    if (hit !== undefined) {
      if (record !== hit) setData({ record: hit, loading: false, error: null });
      return;
    }
    let cancelled = false;
    let request = recordInflight.get(id);
    if (!request) {
      request = dataApi
        .retrieveRow('account', { id, select: ['accountid', 'name'] })
        .then((row: AccountRecord) => { recordCache.set(id, row); return row; })
        .finally(() => { if (recordInflight.get(id) === request) recordInflight.delete(id); });
      recordInflight.set(id, request);
    }
    request
      .then((row) => { if (!cancelled) setData({ record: row, loading: false, error: null }); })
      .catch((failure) => { if (!cancelled) setData({ record: null, loading: false, error: reportPageError(PAGE_NAME, 'loadAccount', undefined, failure, 'read') }); });
    return () => { cancelled = true; };
  }, [dataReady, recordId]);

  return (
    <div>
      <PageErrorBar error={error} />
      {loading ? <Spinner /> : record && <Text>{record.name}</Text>}
    </div>
  );
}`, `type AccountRecord = { accountid: string; name: string };
const winAny = window as any;
const recordCache: Map<string, AccountRecord> = winAny.__ppAccountDetailCache ?? (winAny.__ppAccountDetailCache = new Map());
const recordInflight: Map<string, Promise<AccountRecord>> = winAny.__ppAccountDetailInflight ?? (winAny.__ppAccountDetailInflight = new Map());

`);

const ACTION_TYPES = `type ActionResult = { ok: boolean; indeterminate?: boolean; outputs?: Record<string, unknown>; error?: { message: string; code?: string } };
type ActionApi = {
  executeAction?: (request: { name: string; parameters?: Record<string, unknown>; boundTo?: { entityName: string; id: string } }) => Promise<ActionResult>;
  executeFunction?: (request: { name: string; parameters?: Record<string, unknown> }) => Promise<ActionResult>;
};

`;
const ACTION = page(`function PageBody(props: GeneratedComponentProps) {
  const { dataApi, pageInput } = props;
  const actionApi = dataApi as unknown as ActionApi;
  const [approval, setApproval] = React.useState<{ pending: boolean; status: string; error: PageErrorView | null }>({ pending: false, status: '', error: null });
  const [summary, setSummary] = React.useState<{ total: number | null; error: PageErrorView | null }>({ total: null, error: null });
  const pending = React.useRef(false);

  function setActionFailure(view: PageErrorView) {
    setApproval({ pending: false, status: '', error: view });
  }

  function setSummaryFailure(view: PageErrorView) {
    setSummary({ total: null, error: view });
  }

  function retryApprove() {
    void approveOrder(pageInput?.recordId ?? '');
  }

  function retrySummary() {
    void loadSummary(pageInput?.recordId ?? '');
  }

  async function approveOrder(recordId: string) {
    if (typeof actionApi.executeAction !== 'function') return;
    if (pending.current || !recordId) return;
    pending.current = true;
    setApproval({ pending: true, status: '', error: null });
    try {
      const res = await actionApi.executeAction({
        name: 'cnt_ApproveOrder',
        parameters: { Comment: 'Approved' },
        boundTo: { entityName: 'salesorder', id: recordId },
      });
      if (res.indeterminate) { setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', res.error?.code, res.error?.message, 'indeterminate')); return; }
      if (res.error?.code === 'indeterminate') { setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', res.error?.code, res.error?.message, 'indeterminate')); return; }
      if (!res.ok && res.error?.code === 'network') { setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', res.error?.code, res.error?.message, 'network', retryApprove)); return; }
      if (!res.ok) { setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', res.error?.code, res.error?.message, 'write')); return; }
      const status = res.outputs?.NewStatus;
      setApproval({ pending: false, status: typeof status === 'string' ? status : '', error: null });
    } catch (error) {
      setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', undefined, error, 'write'));
    } finally {
      pending.current = false;
    }
  }

  async function loadSummary(orderId: string) {
    if (typeof actionApi.executeFunction !== 'function') return;
    try {
      const res = await actionApi.executeFunction({ name: 'cnt_GetOrderSummary', parameters: { OrderId: orderId } });
      if (res.indeterminate) { setSummaryFailure(reportPageError(PAGE_NAME, 'loadSummary', res.error?.code, res.error?.message, 'indeterminate')); return; }
      if (res.error?.code === 'indeterminate') { setSummaryFailure(reportPageError(PAGE_NAME, 'loadSummary', res.error?.code, res.error?.message, 'indeterminate')); return; }
      if (!res.ok && res.error?.code === 'network') { setSummaryFailure(reportPageError(PAGE_NAME, 'loadSummary', res.error?.code, res.error?.message, 'network', retrySummary)); return; }
      if (!res.ok) { setSummaryFailure(reportPageError(PAGE_NAME, 'loadSummary', res.error?.code, res.error?.message, 'read', retrySummary)); return; }
      const total = res.outputs?.Total;
      setSummary({ total: typeof total === 'number' ? total : null, error: null });
    } catch (error) {
      setSummaryFailure(reportPageError(PAGE_NAME, 'loadSummary', undefined, error, 'read', retrySummary));
    }
  }

  return (
    <div>
      <PageErrorBar error={approval.error} />
      <PageErrorBar error={summary.error} />
      <Button disabled={approval.pending} onClick={() => void approveOrder(pageInput?.recordId ?? '')}>Approve</Button>
      <Button onClick={() => void loadSummary(pageInput?.recordId ?? '')}>Show summary</Button>
      {approval.status && <Text>{approval.status}</Text>}
      {summary.total !== null && <Text>{summary.total}</Text>}
    </div>
  );
}`, ACTION_TYPES);
const ACTION_BINDINGS = [
  { name: 'cnt_ApproveOrder', isFunction: false, boundEntityLogicalName: 'salesorder', displayName: 'Approve Order', parameterKinds: { Comment: 'String' } },
  { name: 'cnt_GetOrderSummary', isFunction: true, displayName: 'Summary', parameterKinds: { OrderId: 'Guid' } },
];
const ACTION_OUTPUTS = { cnt_ApproveOrder: ['NewStatus'], cnt_GetOrderSummary: ['Total'] };

const BUILT_IN_HELPERS = `type BuiltInResult = { ok: boolean; outputs?: Record<string, unknown>; error?: { message?: string; code?: string; status?: number } };
type BuiltInApi = { executeFunction?: (request: { name: string }) => Promise<BuiltInResult> };
type IdentityView = { identity?: { userId: string; businessUnitId: string; organizationId: string }; error?: PageErrorView };
type VersionView = { version?: string; error?: PageErrorView };

const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// An output only when it is the object's OWN string property.
function ownString(outputs: Record<string, unknown>, field: string): string | undefined {
  const value = Object.prototype.hasOwnProperty.call(outputs, field) ? outputs[field] : undefined;
  return typeof value === 'string' ? value : undefined;
}

async function readIdentity(api: BuiltInApi): Promise<IdentityView> {
  if (typeof api.executeFunction !== 'function') {
    const view = reportPageError(PAGE_NAME, 'showIdentity', undefined, 'executeFunction is not available in this player', 'read');
    view.fallbackKey = 'error.builtinUnsupported';
    return { error: view };
  }
  try {
    const res = await api.executeFunction({ name: 'WhoAmI' });
    if (res.ok !== true) {
      const view = reportPageError(PAGE_NAME, 'showIdentity', res.error?.code, res.error?.message, 'read');
      const unavailable = typeof res.error?.status === 'number' && res.error.status === 404;
      view.fallbackKey = unavailable ? 'error.builtinUnavailable' : 'error.builtinFailed';
      view.message = unavailable ? '' : view.message;
      return { error: view };
    }
    const outputs = res.outputs;
    if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
      const view = reportPageError(PAGE_NAME, 'showIdentity', undefined, 'WhoAmI returned no output object', 'read');
      view.fallbackKey = 'error.builtinUnexpected';
      view.message = '';
      return { error: view };
    }
    const userId = ownString(outputs, 'UserId');
    const businessUnitId = ownString(outputs, 'BusinessUnitId');
    const organizationId = ownString(outputs, 'OrganizationId');
    if (![userId, businessUnitId, organizationId].every((id) => typeof id === 'string' && GUID.test(id))) {
      const view = reportPageError(PAGE_NAME, 'showIdentity', undefined, 'WhoAmI returned an unexpected identity', 'read');
      view.fallbackKey = 'error.builtinUnexpected';
      view.message = '';
      return { error: view };
    }
    return { identity: { userId: userId as string, businessUnitId: businessUnitId as string, organizationId: organizationId as string } };
  } catch (error) {
    const view = reportPageError(PAGE_NAME, 'showIdentity', undefined, error, 'read');
    view.fallbackKey = 'error.builtinFailed';
    view.message = '';
    return { error: view };
  }
}

async function readVersion(api: BuiltInApi): Promise<VersionView> {
  if (typeof api.executeFunction !== 'function') {
    const view = reportPageError(PAGE_NAME, 'showVersion', undefined, 'executeFunction is not available in this player', 'read');
    view.fallbackKey = 'error.builtinUnsupported';
    return { error: view };
  }
  try {
    const res = await api.executeFunction({ name: 'RetrieveVersion' });
    if (res.ok !== true) {
      const view = reportPageError(PAGE_NAME, 'showVersion', res.error?.code, res.error?.message, 'read');
      const unavailable = typeof res.error?.status === 'number' && res.error.status === 404;
      view.fallbackKey = unavailable ? 'error.builtinUnavailable' : 'error.builtinFailed';
      view.message = unavailable ? '' : view.message;
      return { error: view };
    }
    const outputs = res.outputs;
    if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
      const view = reportPageError(PAGE_NAME, 'showVersion', undefined, 'RetrieveVersion returned no output object', 'read');
      view.fallbackKey = 'error.builtinUnexpected';
      view.message = '';
      return { error: view };
    }
    const version = ownString(outputs, 'Version');
    if (!version || version.length > 128) {
      const view = reportPageError(PAGE_NAME, 'showVersion', undefined, 'RetrieveVersion returned an unexpected version', 'read');
      view.fallbackKey = 'error.builtinUnexpected';
      view.message = '';
      return { error: view };
    }
    return { version };
  } catch (error) {
    const view = reportPageError(PAGE_NAME, 'showVersion', undefined, error, 'read');
    view.fallbackKey = 'error.builtinFailed';
    view.message = '';
    return { error: view };
  }
}

`;
const BUILT_INS = page(`function PageBody(props: GeneratedComponentProps) {
  const { dataApi } = props;
  const api = dataApi as unknown as BuiltInApi;
  const mounted = React.useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);

  const [identityState, setIdentityState] = React.useState<{ pending: boolean; view: IdentityView }>({ pending: false, view: {} });
  const identityRequest = React.useRef(0);
  const showIdentity = async () => {
    if (identityState.pending) return;
    const requestId = ++identityRequest.current;
    setIdentityState({ pending: true, view: {} });
    try {
      const view = await readIdentity(api);
      if (mounted.current && requestId === identityRequest.current) setIdentityState({ pending: false, view });
    } catch (error) {
      if (mounted.current && requestId === identityRequest.current) setIdentityState({ pending: false, view: { error: reportPageError(PAGE_NAME, 'showIdentity', undefined, error, 'read') } });
    }
  };

  const [versionState, setVersionState] = React.useState<{ pending: boolean; view: VersionView }>({ pending: false, view: {} });
  const versionRequest = React.useRef(0);
  const showVersion = async () => {
    if (versionState.pending) return;
    const requestId = ++versionRequest.current;
    setVersionState({ pending: true, view: {} });
    try {
      const view = await readVersion(api);
      if (mounted.current && requestId === versionRequest.current) setVersionState({ pending: false, view });
    } catch (error) {
      if (mounted.current && requestId === versionRequest.current) setVersionState({ pending: false, view: { error: reportPageError(PAGE_NAME, 'showVersion', undefined, error, 'read') } });
    }
  };

  return (
    <div>
      <Button disabled={identityState.pending} onClick={() => void showIdentity()}>Show my Dataverse identity</Button>
      <PageErrorBar error={identityState.view.error ?? null} />
      {identityState.view.identity && (
        <div>
          <Text>Dataverse user id: {identityState.view.identity.userId}</Text>
          <Text>Business unit id: {identityState.view.identity.businessUnitId}</Text>
          <Text>Organization id: {identityState.view.identity.organizationId}</Text>
          <Text>The organization id is not an Entra tenant id.</Text>
        </div>
      )}
      <Button disabled={versionState.pending} onClick={() => void showVersion()}>Show the Dataverse server version</Button>
      <PageErrorBar error={versionState.view.error ?? null} />
      {versionState.view.version && <Text>Server version: {versionState.view.version}</Text>}
    </div>
  );
}`, BUILT_IN_HELPERS);
const BUILT_IN_NAMES = ['WhoAmI', 'RetrieveVersion'];
const BUILT_IN_BINDINGS = getDataverseOperationCatalogue().operations.map((operation) => ({ name: operation.name, isFunction: true, displayName: operation.displayName, parameterKinds: {} }));

const GROUPED_HELPERS = `type AccountRow = { accountid: string; name: string };
type ContactRow = { contactid: string; fullname: string };
type Both = { accounts: AccountRow[]; contacts: ContactRow[]; error: PageErrorView | null };
// A named result type: the receiver proof reads a helper's body after its parameter list, and an inline object return
// type would be taken for that body.
type AccountsResult = { rows?: AccountRow[]; error?: PageErrorView };
type ContactsResult = { rows?: ContactRow[]; error?: PageErrorView };

async function readAccounts(api: GeneratedComponentProps['dataApi']): Promise<AccountsResult> {
  try {
    const result = await api.queryTable<AccountRow>('account', { select: ['accountid', 'name'] });
    return { rows: result.rows };
  } catch (error) {
    return { error: reportPageError(PAGE_NAME, 'loadAccounts', undefined, error, 'read') };
  }
}

async function readContacts(api: GeneratedComponentProps['dataApi']): Promise<ContactsResult> {
  try {
    const result = await api.queryTable<ContactRow>('contact', { select: ['contactid', 'fullname'] });
    return { rows: result.rows };
  } catch (error) {
    return { error: reportPageError(PAGE_NAME, 'loadContacts', undefined, error, 'read') };
  }
}

`;
const GROUPED = page(`function PageBody(props: GeneratedComponentProps) {
  const { dataApi } = props;
  const [both, setBoth] = React.useState<Both>({ accounts: [], contacts: [], error: null });
  const [settled, setSettled] = React.useState<Both>({ accounts: [], contacts: [], error: null });

  async function refreshAll() {
    const [accounts, contacts] = await Promise.all([readAccounts(dataApi), readContacts(dataApi)]);
    setBoth({ accounts: accounts.rows ?? [], contacts: contacts.rows ?? [], error: accounts.error ?? contacts.error ?? null });
  }

  async function refreshSettled() {
    const [accounts, contacts] = await Promise.allSettled([
      dataApi.queryTable<AccountRow>('account', { select: ['accountid', 'name'] }),
      dataApi.queryTable<ContactRow>('contact', { select: ['contactid', 'fullname'] }),
    ]);
    let error: PageErrorView | null = null;
    if (accounts.status === 'rejected') error = reportPageError(PAGE_NAME, 'loadAccounts', undefined, accounts.reason, 'read');
    if (contacts.status === 'rejected') error = reportPageError(PAGE_NAME, 'loadContacts', undefined, contacts.reason, 'read');
    setSettled({
      accounts: accounts.status === 'fulfilled' ? accounts.value.rows : [],
      contacts: contacts.status === 'fulfilled' ? contacts.value.rows : [],
      error,
    });
  }

  return (
    <div>
      <PageErrorBar error={both.error} />
      <PageErrorBar error={settled.error} />
      <Button onClick={() => void refreshAll()}>Refresh</Button>
      <Button onClick={() => void refreshSettled()}>Refresh both</Button>
      {both.accounts.map((row) => <Text key={row.accountid}>{row.name}</Text>)}
    </div>
  );
}`, GROUPED_HELPERS);

const CONNECTOR = page(`function PageBody(props: GeneratedComponentProps) {
  const { dataApi } = props;
  const connectorApi = dataApi as unknown as ConnectorApi;
  const [weather, setWeather] = React.useState<{ temperature: number | null; error: PageErrorView | null }>({ temperature: null, error: null });

  function setWeatherFailure(view: PageErrorView) {
    setWeather({ temperature: null, error: view });
  }

  function retryWeather() {
    void loadWeather();
  }

  async function loadWeather() {
    if (typeof connectorApi.executeConnectorOperation !== 'function') return;
    try {
      const response = await connectorApi.executeConnectorOperation('new_msnweather', 'CurrentWeather', { Location: 'Seattle' });
      if (!response.ok) { setWeatherFailure(reportPageError(PAGE_NAME, 'loadWeather', undefined, undefined, 'read', retryWeather)); return; }
      const body = response.body as { temperature?: number };
      setWeather({ temperature: typeof body.temperature === 'number' ? body.temperature : null, error: null });
    } catch (error) {
      setWeatherFailure(reportPageError(PAGE_NAME, 'loadWeather', undefined, error, 'read', retryWeather));
    }
  }

  return (
    <div>
      <PageErrorBar error={weather.error} />
      <Button onClick={() => void loadWeather()}>Show the weather</Button>
      {weather.temperature !== null && <Text>{weather.temperature}</Text>}
    </div>
  );
}`, `type ConnectorApi = { executeConnectorOperation?: (connector: string, operation: string, parameters: Record<string, unknown>) => Promise<{ ok: boolean; body: unknown }> };

`);

const MOCK = page(`function PageBody(props: GeneratedComponentProps) {
  const rows = [{ id: '1', name: 'Contoso' }, { id: '2', name: 'Fabrikam' }];
  return <div>{rows.map((row) => <Text key={row.id}>{row.name}</Text>)}</div>;
}`);

function withTelemetry(source) {
  const lines = source.split('\n');
  const at = lines.findIndex((line) => /^\s*console\.error\(/.test(line));
  assert.ok(at > 0);
  return [...lines.slice(0, at + 1), ...TELEMETRY.split('\n'), ...lines.slice(at + 1)].join('\n');
}
const TELEMETRY_PAGE = swap(swap(swap(withTelemetry(FOUNDATION),
  "reportPageError(PAGE_NAME, 'render', undefined, error, 'render');", "reportPageError(PAGE_NAME, 'render', undefined, error, 'render', undefined, this.props.appInsights);"),
  '  <PageErrorBoundary>\n    <PageBody {...props} />', '  <PageErrorBoundary appInsights={props.appInsights}>\n    <PageBody {...props} />'),
  "error: reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write') });", "error: reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write', undefined, props.appInsights) });");

const POSITIVES = { FOUNDATION, CACHE_LIST, CACHE_RECORD, ACTION, BUILT_INS, GROUPED, CONNECTOR, MOCK, TELEMETRY_PAGE };

test('the page error evaluator is importable by name, with its registered assertion text and the finite call inventory', () => {
  for (const name of ['pageErrorProblems', 'telemetrySafeSpans', 'gradePageErrors', 'pageErrorFingerprint', 'exemption']) {
    assert.equal(typeof evidence[name], 'function', `${name} is exported`);
  }
  assert.equal(PAGE_ERROR_ASSERTION, 'Generated .tsx routes every supported dataApi failure through reportPageError and mounts PageErrorBoundary around PageBody');
  assert.deepEqual(LISTED_METHODS, ['queryTable', 'retrieveRow', 'createRow', 'updateRow', 'deleteRow', 'getChoices', 'queryConnectorTable',
    'executeConnectorOperation', 'executeAction', 'executeFunction', 'listBoundActions']);
});

test('every positive page passes: a direct write, both cache patterns, Custom API Action and Function, built-ins, grouped reads, a connector, a mock page and telemetry', () => {
  for (const [label, source] of Object.entries(POSITIVES)) {
    assert.deepEqual(problems(source), [], label);
    assert.deepEqual(pageStructureProblems(source), [], `${label}: a whole page`);
    assert.deepEqual(nestedDefinitionProblems(source), [], `${label}: components and utilities stay top level (Rule 3)`);
  }
});

test('the complete Custom API page passes the existing runtime check through the boundary wrapper', () => {
  assert.deepEqual(runtimeProblems(ACTION, ACTION_BINDINGS, ACTION_OUTPUTS, new Map()), []);
  // The wrapper is what proves the receiver: forward anything else and the existing check refuses the page.
  const spoofed = swap(ACTION, '<PageBody {...props} />', '<PageBody {...props} dataApi={props.dataApi} />');
  assert.ok(runtimeProblems(spoofed, ACTION_BINDINGS, ACTION_OUTPUTS, new Map()).some((problem) => /not the page's dataApi prop/.test(problem)));
});

test('the two-level built-in page passes both existing built-in checks through the boundary wrapper', () => {
  assert.deepEqual(builtInRuntimeProblems(BUILT_INS, BUILT_IN_NAMES), []);
  assert.deepEqual(runtimeProblems(BUILT_INS, BUILT_IN_BINDINGS, undefined, new Map(), new Set(BUILT_IN_NAMES)), []);
  for (const name of BUILT_IN_NAMES) assert.deepEqual(builtInRuntimeProblems(BUILT_INS, [name]), [], name);
});

// ---------- the old file-wide check, and what the grammar refuses instead ----------

test('the old try/catch check passes what the grammar refuses: an unawaited call, an async callback under an outer try, a missing result guard', () => {
  const cases = [
    ['an unawaited write inside a try', swap(FOUNDATION, "await dataApi.createRow('account', { name });", "void dataApi.createRow('account', { name });"), /not awaited/],
    ['an async callback under an outer try', swap(FOUNDATION, "      await dataApi.createRow('account', { name });\n", "      setTimeout(async () => { await dataApi.createRow('account', { name }); }, 0);\n"), /outside a try|own function/],
    ['an Action with no indeterminate guard', swap(ACTION, "      if (res.indeterminate) { setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', res.error?.code, res.error?.message, 'indeterminate')); return; }\n", ''), /res\.indeterminate/],
  ];
  for (const [label, source, reason] of cases) {
    assert.equal(oldVerdict(source), 'pass', `${label}: the old file-wide assertion still passes it`);
    refused(source, reason, label);
  }
});

test('Custom API results: both indeterminate forms come first, network after them, non-ok before outputs, each reporting before it returns', () => {
  const guard = (operation, kind, extra = '') => `{ setActionFailure(reportPageError(PAGE_NAME, '${operation}', res.error?.code, res.error?.message, '${kind}'${extra})); return; }`;
  refused(swap(ACTION, `if (res.error?.code === 'indeterminate') ${guard('approveOrder', 'indeterminate')}\n`, ''), /indeterminate/, 'no code-only indeterminate guard');
  refused(swap(ACTION, `if (!res.ok) ${guard('approveOrder', 'write')}`, ''), /res\.ok/, 'no non-ok guard');
  const networkFirst = swap(swap(ACTION,
    `      if (res.indeterminate) ${guard('approveOrder', 'indeterminate')}\n`, ''),
    `      if (!res.ok && res.error?.code === 'network') ${guard('approveOrder', 'network', ', retryApprove')}\n`,
    `      if (!res.ok && res.error?.code === 'network') ${guard('approveOrder', 'network', ', retryApprove')}\n      if (res.indeterminate) ${guard('approveOrder', 'indeterminate')}\n`);
  refused(networkFirst, /before/, 'network checked before the indeterminate flag');
  refused(swap(ACTION, `if (res.indeterminate) ${guard('approveOrder', 'indeterminate')}`, `if (res.indeterminate) { setApproval({ pending: false, status: '', error: null }); return; }`), /indeterminate/, 'an indeterminate guard that reports nothing');
  refused(swap(ACTION, `if (res.indeterminate) ${guard('approveOrder', 'indeterminate')}`, `if (res.indeterminate) { setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', res.error?.code, res.error?.message, 'write')); return; }`), /indeterminate/, 'an indeterminate result reported as a write');
  refused(swap(ACTION, `if (!res.ok) ${guard('approveOrder', 'write')}`, `if (!res.ok) { setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', res.error?.code, res.error?.message, res.indeterminate ? 'indeterminate' : 'write')); return; }`), /literal/, 'a ternary kind');
  refused(swap(CONNECTOR, "if (!response.ok) { setWeatherFailure(reportPageError(PAGE_NAME, 'loadWeather', undefined, undefined, 'read', retryWeather)); return; }\n", ''), /response\.ok/, 'a connector operation without its ok guard');
});

test('grouped reads: an outer catch over allSettled, an unchecked rejected item and data calls straight inside Promise.all fail', () => {
  refused(swap(GROUPED, "    if (contacts.status === 'rejected') error = reportPageError(PAGE_NAME, 'loadContacts', undefined, contacts.reason, 'read');\n", ''), /contacts.*rejected|rejected.*contacts/, 'one rejected item never reported');
  const outerCatch = swap(swap(GROUPED,
    "    if (accounts.status === 'rejected') error = reportPageError(PAGE_NAME, 'loadAccounts', undefined, accounts.reason, 'read');\n    if (contacts.status === 'rejected') error = reportPageError(PAGE_NAME, 'loadContacts', undefined, contacts.reason, 'read');\n", ''),
    '    const [accounts, contacts] = await Promise.allSettled([', '    try {\n    const [accounts, contacts] = await Promise.allSettled([');
  refused(swap(outerCatch, '      error,\n    });\n  }', "      error,\n    });\n    } catch (failure) { setSettled({ accounts: [], contacts: [], error: reportPageError(PAGE_NAME, 'loadBoth', undefined, failure, 'read') }); }\n  }"), /rejected/, 'an outer catch around allSettled');
  refused(swap(GROUPED, 'await Promise.all([readAccounts(dataApi), readContacts(dataApi)])', "await Promise.all([dataApi.queryTable<AccountRow>('account', {}), dataApi.queryTable<ContactRow>('contact', {})])"), /Promise\.all/, 'data calls straight inside Promise.all');
});

test('cache: a catch on another binding, a second producer, a producer that catches and a rejection written to the cache fail', () => {
  const consumer = '    inflight\n      .then((loaded) =>';
  refused(swap(CACHE_LIST, consumer, '    const other = inflight;\n    other\n      .then((loaded) =>'), /catch|consum/, 'the consumer chain is on another binding');
  refused(swap(CACHE_LIST, '      winAny[INFLIGHT_KEY] = inflight;\n    }', "      winAny[INFLIGHT_KEY] = inflight;\n    }\n    inflight = Promise.resolve([] as AccountRow[]);"), /assign/, 'a second assignment to the in-flight binding');
  refused(swap(CACHE_LIST, "        .finally(() => { if (winAny[INFLIGHT_KEY] === inflight) delete winAny[INFLIGHT_KEY]; });", "        .catch(() => [] as AccountRow[])\n        .finally(() => { if (winAny[INFLIGHT_KEY] === inflight) delete winAny[INFLIGHT_KEY]; });"), /producer|cach/, 'the producer turns a rejection into rows');
  refused(swap(CACHE_LIST, ".catch((failure) => { if (!cancelled) setData(", ".catch((failure) => { winAny[CACHE_KEY] = []; if (!cancelled) setData("), /cache/, 'the consumer caches the rejection as data');
  refused(swap(CACHE_RECORD, '.catch((failure) => { if (!cancelled) setData(', '.catch((failure) => { recordCache.set(id, null as unknown as AccountRecord); if (!cancelled) setData('), /cache/, 'a per-record cache written on rejection');
});

test('a discarded view, a view kept in state no PageErrorBar renders, and a return before the live report fail', () => {
  refused(swap(FOUNDATION, "setSave({ saving: false, error: reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write') });", "reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write');\n      setSave({ saving: false, error: null });"), /discard/, 'the view is thrown away');
  refused(swap(FOUNDATION, '<PageErrorBar error={save.error} />', ''), /never rendered|PageErrorBar/, 'the error state is never rendered');
  refused(swap(FOUNDATION, "    } catch (error) {\n      setSave(", "    } catch (error) {\n      if (name) return;\n      setSave("), /before/, 'a return that is not a staleness guard comes before the report');
  // A narrow staleness guard may return first: the live branch still reports.
  const guarded = swap(swap(FOUNDATION, "    } catch (error) {\n      setSave(", "    } catch (error) {\n      if (!mounted.current) return;\n      setSave("),
    '  const pending = React.useRef(false);\n', '  const pending = React.useRef(false);\n  const mounted = React.useRef(true);\n  React.useEffect(() => () => { mounted.current = false; }, []);\n');
  assert.deepEqual(problems(guarded), []);
  refused(swap(guarded, '  React.useEffect(() => () => { mounted.current = false; }, []);\n', ''), /not a staleness guard/, 'a "mounted" ref nothing ever clears');
  refused(swap(guarded, 'const mounted = React.useRef(true);', 'const [mounted] = React.useState({ current: true });'), /before/, 'a guard on state, not a ref');
  refused(swap(FOUNDATION, "      setSave({ saving: false, error: reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write') });",
    "      if (name) setSave({ saving: false, error: reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write') });"), /not a staleness guard/, 'a report only under a data condition');
});

test('a report counts only where its failure runs: not behind `&&` or `?:`, in a function never called, in an inner block, after a latch return or past a swallowed rejection', () => {
  const report = "setSave({ saving: false, error: reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write') });";
  const indeterminate = "      if (res.indeterminate) { setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', res.error?.code, res.error?.message, 'indeterminate')); return; }";
  const settled = "    if (accounts.status === 'rejected') error = reportPageError(PAGE_NAME, 'loadAccounts', undefined, accounts.reason, 'read');";
  for (const [label, source, reason] of [
    ['a report behind `false &&`', swap(FOUNDATION, report, `false && ${report}`), /expression or another block/],
    ['a report in a conditional expression', swap(FOUNDATION, report, `name ? ${report.slice(0, -1)} : undefined;`), /expression or another block/],
    ['a report in a function the catch defines and never calls', swap(FOUNDATION, report, `const ignored = () => { ${report} };`), /function it defines/],
    ['a report in an inner block', swap(FOUNDATION, report, `{ ${report} }`), /expression or another block/],
    ['a report under a data condition', swap(FOUNDATION, report, `if (name) { ${report} }`), /not a staleness guard/],
    ['a return on the pending latch first', swap(FOUNDATION, report, `if (pending.current) return;\n      ${report}`), /not a staleness guard/],
    ['a rejection swallowed before the catch', swap(FOUNDATION, "await dataApi.createRow('account', { name });", "await dataApi.createRow('account', { name }).catch(() => undefined);"), /chained/],
    ['an indeterminate guard whose report never runs', swap(ACTION, indeterminate, "      if (res.indeterminate) { if (false) { setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', res.error?.code, res.error?.message, 'indeterminate')); } return; }"), /res\.indeterminate guard/],
    ['a rejected item reported behind `void`', swap(GROUPED, settled, "    if (accounts.status === 'rejected') void (error = reportPageError(PAGE_NAME, 'loadAccounts', undefined, accounts.reason, 'read'));"), /rejected branch of accounts/],
  ]) refused(source, reason, label);
  // Fixture 27's order read, its report put behind `false &&`: the whole fixture fails the common assertion.
  const fixture = fs.readFileSync(path.join(__dirname, '..', 'fixtures', '27-page-error-helper', 'order-approvals.tsx'), 'utf8');
  const detail = "      setDetail({ order: null, loading: false, error: reportPageError(PAGE_NAME, 'loadOrder', undefined, failure, 'read', retryDetail) });";
  const silent = swap(fixture, detail, `      false && ${detail.trim()}`);
  assert.equal(gradePageErrors({ files: [{ path: '/fixtures/27-page-error-helper/order-approvals.tsx', name: 'order-approvals.tsx', content: silent }] }).status, 'fail');
});

test('staleness guards are read with their polarity: a request counter, an unmounted flag and a cancelled flag, never a latch or data', () => {
  const counted = swap(swap(swap(FOUNDATION,
    '  const pending = React.useRef(false);\n', '  const pending = React.useRef(false);\n  const request = React.useRef(0);\n'),
    '    pending.current = true;\n', '    pending.current = true;\n    const requestId = ++request.current;\n'),
    "    } catch (error) {\n      setSave(", "    } catch (error) {\n      if (requestId !== request.current) return;\n      setSave(");
  assert.deepEqual(problems(counted), [], 'an older request returns before reporting');
  refused(swap(counted, 'if (requestId !== request.current) return;', 'if (requestId === request.current) return;'), /not a staleness guard/, 'the current request returning instead');
  const kept = swap(counted, "      if (requestId !== request.current) return;\n      setSave({ saving: false, error: reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write') });",
    "      if (requestId === request.current) setSave({ saving: false, error: reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write') });");
  assert.deepEqual(problems(kept), [], 'a report kept for the current request');
  refused(swap(kept, 'if (requestId === request.current) setSave(', 'if (requestId !== request.current) setSave('), /not a staleness guard/, 'a report kept only for an older request');
  refused(swap(counted, 'const requestId = ++request.current;', 'const requestId = request.current;'), /not a staleness guard/, 'a "request id" that is never counted');
  // The double-submit latch is cleared in `finally`, not in a cleanup: it is no unmounted flag, whichever way it is read.
  refused(swap(FOUNDATION, "    } catch (error) {\n      setSave(", "    } catch (error) {\n      if (!pending.current) return;\n      setSave("), /not a staleness guard/, 'the latch read as an unmounted flag');
  // A cancelled flag starts false and turns true only in the effect's cleanup.
  assert.deepEqual(problems(CACHE_LIST), [], 'the cached read and its cancelled flag');
  refused(swap(CACHE_LIST, '    let cancelled = false;\n', '    let cancelled = false;\n    cancelled = true;\n'), /not a staleness guard/, 'a cancelled flag set outside the cleanup');
});

test('a stored view reaches a bar that renders: not behind a condition, a ternary or a return, not overwritten first, and the bar is the canonical one that never calls its retry', () => {
  const report = "setSave({ saving: false, error: reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write') });";
  const bar = '<PageErrorBar error={save.error} />';
  const finalReturn = '  return (\n    <div>\n      <PageErrorBar';
  for (const [label, source, reason] of [
    ['a bar behind `false &&`', swap(FOUNDATION, bar, `{false && ${bar}}`), /never rendered/],
    ['a bar under a state condition', swap(FOUNDATION, bar, `{save.saving && ${bar}}`), /never rendered/],
    ['a bar in a ternary', swap(FOUNDATION, bar, `{name ? ${bar} : null}`), /never rendered/],
    ['a bar after an unconditional return', swap(FOUNDATION, finalReturn, `  return null;\n${finalReturn}`), /never rendered/],
    ['a bar that returns nothing first', swap(FOUNDATION, '  if (!error) return null;\n  return (', '  if (!error) return null;\n  return null;\n  return ('), /PageErrorBar must be the canonical/],
    ['a bar that calls the retry while it renders', swap(FOUNDATION, '<Button onClick={error.retry}>', '<Button onClick={error.retry()}>'), /PageErrorBar must be the canonical/],
    ['a reported view overwritten before it is stored', swap(FOUNDATION, report, "let view = reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write');\n      view = null;\n      setSave({ saving: false, error: view });"), /overwritten/],
  ]) refused(source, reason, label);
  // A return on a condition (a loading state) does not hide the final return, and the bar without its retry part is the
  // documented form for a page that never offers a retry.
  assert.deepEqual(problems(swap(FOUNDATION, finalReturn, `  if (save.saving) return <span>Saving…</span>;\n${finalReturn}`)), [], 'a conditional early return');
  const plain = swap(FOUNDATION, "      {error.retry && (\n        <MessageBarActions>\n          <Button onClick={error.retry}>{translate('error.tryAgain')}</Button>\n        </MessageBarActions>\n      )}\n", '');
  assert.deepEqual(problems(plain), [], 'the bar without its retry part');
  // Fixture 27 with its bar calling the network retry on every render: the whole fixture fails the common assertion.
  const fixture = fs.readFileSync(path.join(__dirname, '..', 'fixtures', '27-page-error-helper', 'order-approvals.tsx'), 'utf8');
  const autoRetry = swap(fixture, '<Button onClick={error.retry}>', '<Button onClick={error.retry()}>');
  assert.equal(gradePageErrors({ files: [{ path: '/fixtures/27-page-error-helper/order-approvals.tsx', name: 'order-approvals.tsx', content: autoRetry }] }).status, 'fail');
});

test('returned views: a caller that drops the result, a result kept where nothing renders it, a try without catch and a bare chain fail', () => {
  const kept = "      const view = await readIdentity(api);\n      if (mounted.current && requestId === identityRequest.current) setIdentityState({ pending: false, view });";
  refused(swap(BUILT_INS, kept, "      await readIdentity(api);\n      if (mounted.current && requestId === identityRequest.current) setIdentityState({ pending: false, view: {} });"), /discarded/, 'the helper result is dropped');
  refused(swap(BUILT_INS, '      <PageErrorBar error={identityState.view.error ?? null} />\n', ''), /never rendered|PageErrorBar/, 'the helper error is kept where nothing renders it');
  refused(swap(FOUNDATION, "    } catch (error) {\n      setSave({ saving: false, error: reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write') });\n    } finally {", '    } finally {'), /try with a catch/, 'a try with only finally');
  refused(swap(FOUNDATION, "      await dataApi.createRow('account', { name });\n      setSave({ saving: false, error: null });",
    "      dataApi.createRow('account', { name })\n        .then(() => setSave({ saving: false, error: null }))\n        .catch((failure) => setSave({ saving: false, error: reportPageError(PAGE_NAME, 'createAccount', undefined, failure, 'write') }));"), /unverifiable/, 'a bare then/catch chain held by nothing');
});

test('the boundary wraps PageBody exactly: PageBody(props), no boundary, or an altered boundary fail', () => {
  const wrapper = '  <PageErrorBoundary>\n    <PageBody {...props} />\n  </PageErrorBoundary>';
  refused(swap(FOUNDATION, wrapper, '  <PageErrorBoundary>{PageBody(props)}</PageErrorBoundary>'), /PageErrorBoundary/, 'PageBody evaluated in the parent render');
  refused(swap(FOUNDATION, wrapper, '  <PageBody {...props} />'), /PageErrorBoundary/, 'no boundary');
  refused(swap(FOUNDATION, "reportPageError(PAGE_NAME, 'render', undefined, error, 'render');", 'console.error(error);'), /componentDidCatch/, 'a boundary that logs the raw error instead of reporting');
  refused(swap(FOUNDATION, "        <MessageBar intent=\"error\">\n          <MessageBarBody>{translate('error.render')}</MessageBarBody>\n        </MessageBar>", '        <Text>Something went wrong</Text>'), /fallback|render/, 'a boundary fallback that is not the localized copy');
  refused(swap(FOUNDATION, '    return this.props.children;\n', "    return <div><Button onClick={() => this.setState({ failed: false })}>Retry</Button>{this.props.children}</div>;\n"), /reset|setState/, 'a boundary with a reset');
  refused(swap(FOUNDATION, '      <MessageBarBody>{error.message || translate(error.fallbackKey)}</MessageBarBody>', '      <MessageBarBody>{error.code}</MessageBarBody>'), /PageErrorBar/, 'an error bar that shows the code instead of the message');
});

test('reporter calls: five arguments with a literal kind at index 4, retry only on reads and network and passed not called, built-ins read with no retry', () => {
  const call = "reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write')";
  refused(swap(FOUNDATION, call, "reportPageError(PAGE_NAME, 'createAccount', error, 'write')"), /five/, 'the old four-argument call');
  refused(swap(FOUNDATION, call, "reportPageError(PAGE_NAME, 'createAccount', undefined, error, kindOf(error))"), /literal/, 'a computed kind');
  refused(swap(FOUNDATION, call, "reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write', createAccount)"), /retry/, 'a write offering a retry');
  refused(swap(CACHE_LIST, "'read', retryLoad)", "'read', retryLoad())"), /retry/, 'a retry called instead of passed');
  refused(swap(FOUNDATION, call, "reportPageError(PAGE_NAME, 'create' + name, undefined, error, 'write')"), /operation/, 'an operation built from data');
  assert.deepEqual(problems(swap(FOUNDATION, "const PAGE_NAME = 'Account Overview';", 'const PAGE_NAME = "Contoso\'s Accounts";')), [], 'a display name with an apostrophe');
  refused(swap(FOUNDATION, "const PAGE_NAME = 'Account Overview';", "const PAGE_NAME = 'Account ' + window.name;"), /PAGE_NAME/, 'a computed page name');
  refused(swap(FOUNDATION, call, "reportPageError(PAGE_NAME, 'createAccount', undefined, save, 'write')"), /message/, 'a state object passed as the message');
  refused(swap(BUILT_INS, "const view = reportPageError(PAGE_NAME, 'showIdentity', res.error?.code, res.error?.message, 'read');", "const view = reportPageError(PAGE_NAME, 'showIdentity', res.error?.code, res.error?.message, 'network');"), /built-in/, 'a built-in failure classed as network');
  refused(swap(BUILT_INS, "const view = reportPageError(PAGE_NAME, 'showIdentity', res.error?.code, res.error?.message, 'read');", "const view = reportPageError(PAGE_NAME, 'showIdentity', res.error?.code, res.error?.message, 'read', showIdentity);"), /built-in/, 'a built-in failure with a retry');
});

test('a trailing comma after the last argument passes no argument: five-, six- and seven-argument calls, on one line or one per line', () => {
  const call = "reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write')";
  assert.deepEqual(problems(swap(FOUNDATION, call, "reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write',)")), [], 'five, on one line');
  assert.deepEqual(problems(swap(FOUNDATION, call, "reportPageError(\n        PAGE_NAME,\n        'createAccount',\n        undefined,\n        error,\n        'write',\n      )")), [], 'five, one per line');
  assert.deepEqual(problems(swap(CACHE_LIST, "'read', retryLoad)", "'read', retryLoad,)")), [], 'six: a read and its retry');
  assert.deepEqual(problems(swap(CACHE_LIST, "undefined, failure, 'read', retryLoad)", "undefined,\n            failure,\n            'read',\n            retryLoad,\n          )")), [], 'six, one per line');
  const report = "const view = reportPageError(PAGE_NAME, 'showIdentity', res.error?.code, res.error?.message, 'read');";
  for (const [label, seven] of [
    ['seven, on one line', "const view = reportPageError(PAGE_NAME, 'showIdentity', res.error?.code, res.error?.message, 'read', undefined, appInsights,);"],
    ['seven, one per line', "const view = reportPageError(\n        PAGE_NAME,\n        'showIdentity',\n        res.error?.code,\n        res.error?.message,\n        'read',\n        undefined,\n        appInsights,\n      );"],
  ]) {
    const authorized = swap(withTelemetry(BUILT_INS), report, seven);
    assert.deepEqual(problems(authorized), [], label);
    const spans = telemetrySafeSpans(authorized);
    assert.equal(spans.length, 1, `${label}: the telemetry argument is still the one safe span`);
    assert.equal(authorized.slice(spans[0].start, spans[0].end), 'appInsights', label);
  }
  // The comma is not a way past the rules: a write still offers no retry, and a sixth argument is still a retry.
  refused(swap(FOUNDATION, call, "reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write', createAccount,)"), /retry/, 'a write offering a retry, with a trailing comma');
});

test('the kind is the operation\'s: a mutation\'s rejection is a write, never retried; network only in a result\'s network guard; indeterminate only in its two guards; render only in the boundary', () => {
  const report = "reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'write')";
  for (const [label, source, reason] of [
    ['a rejected write relabelled a read, with a retry', swap(FOUNDATION, report, "reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'read', createAccount)"), /this operation's failure is 'write'/],
    ['a rejected write relabelled network, with a retry', swap(FOUNDATION, report, "reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'network', createAccount)"), /this operation's failure is 'write'/],
    ['a rejected read relabelled indeterminate', swap(CACHE_LIST, "undefined, failure, 'read', retryLoad)", "undefined, failure, 'indeterminate')"), /this operation's failure is 'read'/],
    ['a rejected Action reported as network, with its retry', swap(ACTION, "setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', undefined, error, 'write'));", "setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', undefined, error, 'network', retryApprove));"), /this operation's failure is 'write'/],
    ['a failed Action result reported as a read', swap(ACTION, "if (!res.ok) { setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', res.error?.code, res.error?.message, 'write')); return; }", "if (!res.ok) { setActionFailure(reportPageError(PAGE_NAME, 'approveOrder', res.error?.code, res.error?.message, 'read')); return; }"), /guard must report kind 'write'/],
    ['a render kind outside the boundary', swap(FOUNDATION, report, "reportPageError(PAGE_NAME, 'createAccount', undefined, error, 'render')"), /'render' belongs only/],
  ]) refused(source, reason, label);
  // Fixture 27's thrown Action rejection relabelled network with its retry: the common assertion fails the fixture.
  const fixture = fs.readFileSync(path.join(__dirname, '..', 'fixtures', '27-page-error-helper', 'order-approvals.tsx'), 'utf8');
  const relabelled = swap(fixture, "setApprovalFailure(reportPageError(PAGE_NAME, 'approveOrder', undefined, failure, 'write'));", "setApprovalFailure(reportPageError(PAGE_NAME, 'approveOrder', undefined, failure, 'network', retryApprove));");
  assert.equal(gradePageErrors({ files: [{ path: '/fixtures/27-page-error-helper/order-approvals.tsx', name: 'order-approvals.tsx', content: relabelled }] }).status, 'fail');
});

test('a Function or connector failure reported as a read passes, but the grade names that kind as not scored', () => {
  for (const [label, source, expected] of [
    ['a connector operation', CONNECTOR, /not scored: the 'read' kind of .*executeConnectorOperation/],
    ['a Custom API Function', ACTION, /not scored: the 'read' kind of .*executeFunction/],
  ]) {
    const grade = gradePageErrors({ files: [{ path: '/fixtures/99-new/page.tsx', name: 'page.tsx', content: source }] });
    assert.equal(grade.status, 'pass', label);
    assert.match(grade.reason, expected, label);
  }
  // A known mutation, a built-in read and a cached table read are scored: nothing is named.
  for (const source of [FOUNDATION, BUILT_INS, CACHE_LIST]) {
    const grade = gradePageErrors({ files: [{ path: '/fixtures/99-new/page.tsx', name: 'page.tsx', content: source }] });
    assert.deepEqual([grade.status, grade.reason], ['pass', '']);
  }
  // The same Function failure reported as a write needs no score: a write is never retried.
  const asWrite = swap(swap(ACTION,
    "if (!res.ok) { setSummaryFailure(reportPageError(PAGE_NAME, 'loadSummary', res.error?.code, res.error?.message, 'read', retrySummary)); return; }",
    "if (!res.ok) { setSummaryFailure(reportPageError(PAGE_NAME, 'loadSummary', res.error?.code, res.error?.message, 'write')); return; }"),
    "setSummaryFailure(reportPageError(PAGE_NAME, 'loadSummary', undefined, error, 'read', retrySummary));",
    "setSummaryFailure(reportPageError(PAGE_NAME, 'loadSummary', undefined, error, 'write'));");
  assert.deepEqual(pageErrorProblems(asWrite), []);
  assert.deepEqual(gradePageErrors({ files: [{ path: '/fixtures/99-new/page.tsx', name: 'page.tsx', content: asWrite }] }), { status: 'pass', reason: '' });
});

test('the reporter is the canonical one, bound once, and the only code that sends an exception', () => {
  refused(swap(FOUNDATION, "    normalizedMessage = line.length > 300 ? line.slice(0, 299) + '\\u2026' : line;", '    normalizedMessage = line;'), /canonical/, 'an uncapped message');
  refused(swap(FOUNDATION, "{ code: normalizedCode, message: normalizedMessage });", '{ code: normalizedCode, message: normalizedMessage }, message);'), /canonical/, 'a reporter that logs the thrown value');
  refused(`${FOUNDATION}\nfunction reportPageError(pageName: string) { return pageName; }\n`, /once|canonical/, 'a second reporter');
  refused(swap(FOUNDATION, 'function PageBody(', 'const report = reportPageError;\nfunction PageBody('), /value/, 'the reporter handed on as a value');
  refused(swap(TELEMETRY_PAGE, "    setSave({ saving: true, error: null });", "    setSave({ saving: true, error: null });\n    props.appInsights?.trackException?.(new Error('createAccount started'));"), /trackException/, 'an exception sent outside the reporter');
  // The telemetry insertion belongs right after the log line; anywhere else it is not the canonical reporter.
  const misplaced = swap(TELEMETRY_PAGE, "  const quiet = kind === 'indeterminate' || kind === 'render';\n", '');
  refused(misplaced.replace('  return view;\n}', "  const quiet = kind === 'indeterminate' || kind === 'render';\n  return view;\n}"), /canonical/, 'the reporter reordered');
});

test('a receiver that is not provably the page dataApi is unverifiable; retrieveMultipleRecords is not a taught method; an unrelated local object is out of scope', () => {
  refused(swap(FOUNDATION, "await dataApi.createRow('account', { name });", "await (window as any).client.createRow('account', { name });"), /unverifiable/, 'a receiver of unknown provenance');
  refused(swap(FOUNDATION, "await dataApi.createRow('account', { name });", "await dataApi.retrieveMultipleRecords('account', '?$select=name');"), /retrieveMultipleRecords/, 'an API the page DataAPI does not teach');
  const local = swap(MOCK, '  const rows = [', "  const store = { queryTable: (table: string) => Promise.resolve({ rows: [table] }) };\n  void store.queryTable('account');\n  const rows = [");
  assert.deepEqual(problems(local), [], 'a local object literal is not the page dataApi');
  // Only a local proven closed is out of scope: a container that holds the page client, a rebinding, a written or passed
  // object, or an initializer that names the page's scope is unverifiable, never exempt.
  const hidden = swap(swap(FOUNDATION, '  const { dataApi } = props;', '  const services = { client: props.dataApi };'),
    "await dataApi.createRow('account', { name });", "void services.client.createRow('account', { name });");
  refused(hidden, /services\.client is not provably the page dataApi/, 'a local object that holds the page client');
  const storeLine = "  const store = { queryTable: (table: string) => Promise.resolve({ rows: [table] }) };";
  for (const [label, from, to] of [
    ['a let', storeLine, storeLine.replace('const store', 'let store')],
    ['a member written later', "  void store.queryTable('account');", "  store.queryTable = (props.dataApi as any).queryTable;\n  void store.queryTable('account');"],
    ['an object filled through Object.assign', "  void store.queryTable('account');", "  Object.assign(store, props.dataApi);\n  void store.queryTable('account');"],
    ['an initializer that names the page scope', storeLine, "  const store = { queryTable: (props.dataApi as any).queryTable };"],
    ['a new instance', storeLine, '  const store = new Proxy(props.dataApi, {});'],
    ['a second binding of the name', "  void store.queryTable('account');", "  void store.queryTable('account');\n  const reload = (store: any) => store.queryTable('account');"],
  ]) refused(swap(local, from, to), /store(?:\.\w+)? is not provably the page dataApi/, label);
});

test('telemetry-safe spans cover only the seventh argument of a verified canonical read report on an unmodified result or caught error', () => {
  const authorized = swap(withTelemetry(BUILT_INS),
    "const view = reportPageError(PAGE_NAME, 'showIdentity', res.error?.code, res.error?.message, 'read');",
    "const view = reportPageError(PAGE_NAME, 'showIdentity', res.error?.code, res.error?.message, 'read', undefined, appInsights);");
  const spans = telemetrySafeSpans(authorized);
  assert.equal(spans.length, 1);
  assert.equal(authorized.slice(spans[0].start, spans[0].end), 'appInsights');
  assert.ok(authorized.lastIndexOf("'read', undefined, appInsights);", spans[0].start) > 0, 'the span is the reporter call\'s own argument');
  for (const [label, source] of [
    ['a reporter without the canonical body', swap(authorized, "    normalizedMessage = line.length > 300 ? line.slice(0, 299) + '\\u2026' : line;", '    normalizedMessage = line;')],
    ['a retry beside the telemetry', swap(authorized, "'read', undefined, appInsights);", "'read', showIdentity, appInsights);")],
    ['the identity passed as the message', swap(authorized, "res.error?.code, res.error?.message, 'read', undefined, appInsights);", "res.error?.code, String(res.outputs?.UserId), 'read', undefined, appInsights);")],
    ['a result field written before the report', swap(authorized, "    if (res.ok !== true) {\n      const view = reportPageError(PAGE_NAME, 'showIdentity', res.error?.code", "    if (res.ok !== true) {\n      if (res.error) res.error.message = String(res.outputs?.UserId);\n      const view = reportPageError(PAGE_NAME, 'showIdentity', res.error?.code")],
    ['a write kind', swap(authorized, "res.error?.message, 'read', undefined, appInsights);", "res.error?.message, 'write', undefined, appInsights);")],
  ]) assert.deepEqual(telemetrySafeSpans(source), [], label);
  assert.deepEqual(telemetrySafeSpans(BUILT_INS), [], 'no telemetry argument, no span');
});

// ---------- the compatibility ledger ----------

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const LEDGER = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'page-error-allowlist.json'), 'utf8'));

test('the ledger freezes the 37 root pages captured before the contract, by path and newline-normalized fingerprint', () => {
  assert.equal(LEDGER.entries.length, 37);
  assert.equal(new Set(LEDGER.entries.map((entry) => entry.path)).size, 37, 'one entry per path');
  for (const entry of LEDGER.entries) {
    assert.match(entry.path, /^\d+-[a-z0-9-]+\/[A-Za-z0-9-]+\.tsx$/, `${entry.path}: a fixture-relative root page`);
    assert.doesNotMatch(entry.path, /^(?:26|27)-/, 'the contract\'s own fixtures are never exempt');
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.equal(entry.baseline, '2.19.0');
    assert.match(entry.reason, /^Captured before the page error contract/);
    assert.deepEqual(Object.keys(entry).sort(), ['baseline', 'path', 'reason', 'sha256']);
  }
  assert.equal(pageErrorFingerprint('a\r\nb\n'), pageErrorFingerprint('a\nb\n'), 'CRLF and LF checkouts are one source');
  assert.notEqual(pageErrorFingerprint('a\nb\n'), pageErrorFingerprint('a\nb \n'), 'nothing else is normalized');
  assert.notEqual(pageErrorFingerprint('\uFEFFa\n'), pageErrorFingerprint('a\n'), 'not even a byte order mark');
});

test('an unchanged pre-contract page is a compatibility skip; a changed page, a new path or a new fixture is graded', () => {
  const rel = '16-account-list/account-list.tsx';
  const original = fs.readFileSync(path.join(FIXTURES, ...rel.split('/')), 'utf8');
  const file = (name, content, dir = '16-account-list') => ({ path: path.join(FIXTURES, dir, name), name, content });
  assert.ok(exemption(rel, original), 'the committed page matches its entry');
  assert.ok(exemption(rel, original.replace(/\r?\n/g, '\r\n')), 'a CRLF checkout of the same page');
  assert.ok(exemption(rel, original.replace(/\r\n/g, '\n')), 'an LF checkout of the same page');
  const skipped = gradePageErrors({ files: [file('account-list.tsx', original)] });
  assert.equal(skipped.status, 'skip');
  assert.match(skipped.reason, /compatibility/);
  assert.equal(exemption(rel, `${original}\n// edited\n`), null, 'a changed page at the same path');
  assert.equal(gradePageErrors({ files: [file('account-list.tsx', `${original}\n// edited\n`)] }).status, 'fail');
  assert.equal(gradePageErrors({ files: [file('account-list-copy.tsx', original)] }).status, 'fail', 'the same source at a new path is graded');
  assert.equal(gradePageErrors({ files: [file('account-list.tsx', original, '26-customer-lookup')] }).status, 'fail', 'a new fixture is never exempt');
});

test('the fixture verdict: a failing checked page wins, a mix discloses its exempt pages, all exempt skips, no page skips', () => {
  const rel = ['16-account-list', 'account-list.tsx'];
  const original = fs.readFileSync(path.join(FIXTURES, ...rel), 'utf8');
  const exempt = { path: path.join(FIXTURES, ...rel), name: rel[1], content: original };
  const compliant = { path: path.join(FIXTURES, '16-account-list', 'new-page.tsx'), name: 'new-page.tsx', content: FOUNDATION };
  const failing = { ...compliant, name: 'broken.tsx', path: path.join(FIXTURES, '16-account-list', 'broken.tsx'), content: swap(FOUNDATION, '<PageErrorBar error={save.error} />', '') };
  const mixed = gradePageErrors({ files: [exempt, compliant] });
  assert.equal(mixed.status, 'pass');
  assert.match(mixed.reason, /1 .*exempt/);
  assert.equal(gradePageErrors({ files: [compliant] }).status, 'pass');
  const failed = gradePageErrors({ files: [exempt, compliant, failing] });
  assert.equal(failed.status, 'fail');
  assert.match(failed.reason, /^broken\.tsx: /);
  assert.equal(gradePageErrors({ files: [] }).status, 'skip');
});
