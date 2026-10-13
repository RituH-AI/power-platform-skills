# Traditional Site Permissions Audit

Follow this workflow only when the existing SPA lookup found no `powerpages.config.json` and
`detect-project-context.js` returned `siteType: "declarative"`. Preserve the same seven phases,
task tracking, autonomous analysis, A-K table-permission checklist, report schema, skill tracking,
final fix-offer gate, and read-only boundary as the SPA workflow.

Do not execute the SPA-specific source-code discovery or `.powerpages-site` deployment prerequisite.
A traditional site is already represented by downloaded PAC metadata. Its component root may be
`<projectRoot>/.powerpages-site/` or the directly opened PAC export.

Traditional exports can use either PAC serialization:

- **Enhanced:** per-record `web-roles/`, `site-settings/`, and `webpage-rules/` files with the
  normalized field names used by code sites.
- **Standard:** aggregate `webrole.yml`, `sitesetting.yml`, and `webpagerule.yml` files plus
  `adx_`-prefixed component fields.

The audit must read both formats. Do not rewrite one format as the other.

## Phase 1: Verify the Traditional Site

1. Use the context returned by:

   ```bash
   node "${PLUGIN_ROOT}/scripts/lib/detect-project-context.js"
   ```

2. Require `siteType: "declarative"` and record `projectRoot`, `siteRoot`, `siteName`, and
   `websiteRecordId`.
3. Confirm `siteRoot` contains `.portalconfig/` or `website.yml`. Do not require
   `powerpages.config.json`.
4. If `table-permissions/` is absent or empty, retain that as possible evidence rather than
   stopping. The site may still contain active Forms, Lists, Liquid, or Web API callers that need
   permissions.
5. Keep analysis read-only. No local or Dataverse mutation occurs before the final fix offer.

Use the same seven task subjects as the SPA workflow with these descriptions:

| Task subject | Description |
|---|---|
| Verify site deployment | Resolve the traditional project/site roots, identity, and PAC format |
| Gather configuration | Inventory roles, table permissions, page rules, native components, settings, and active content |
| Run local schema validation | Validate supported normalized metadata and retain standard-format/manual checks |
| Discover relationships | Query Dataverse for exact lookup and relationship metadata |
| Run audit checks | Audit every actively used or permission-bearing table and cross-check page/component access |
| Generate audit report | Render the normal permissions audit report under the traditional project root |
| Present findings | Summarize, record usage, and use the existing fix-offer gate |

## Phase 2: Gather Traditional Permission Evidence

Run the deterministic collector:

```bash
node "${PLUGIN_ROOT}/skills/audit-permissions/scripts/collect-traditional-permission-evidence.js" \
  --projectRoot "<projectRoot>"
```

The collector normalizes:

- enhanced `web-roles/*.webrole.yml` and standard `webrole.yml`;
- `table-permissions/*.tablepermission.yml` with normalized or `adx_`-prefixed fields;
- enhanced `site-settings/*.sitesetting.yml` and standard `sitesetting.yml`;
- enhanced `webpage-rules/*.webpagerule.yml` and standard `webpagerule.yml`;
- Basic Forms, Advanced Forms and their steps, Lists, webpages, Liquid/FetchXML, Web API endpoints,
  and active component tags.

Treat every `parseErrors` entry as a critical local-metadata finding with the exact file path. Read
the cited source file to establish the malformed shape; do not guess missing values.

### 2.1 Build the active source graph

Use the collector as a normalized inventory, then establish reachability:

```text
Webpage
  -> Page Template
    -> Web Template
      -> included Web Templates
      -> referenced Content Snippets
      -> referenced JavaScript Web Files
```

Follow:

- `{% entityform name: '...' %}` to an existing Basic Form;
- `{% webform name: '...' %}` to an Advanced Form and all of its steps;
- `{% include 'entity_list' key: '...' %}` to an existing List;
- `{% include %}` calls between reachable templates;
- Liquid `{% fetchxml %}`, `entities[...]`, and entity references;
- relative `/_api/` calls and their HTTP methods;
- webpage/page-template/web-template IDs and names from adjacent metadata.

Do not treat an unused Form, List, template, snippet, or Web File as active merely because it is
downloaded. Plain text, navigation labels, CSS, images, fonts, and unreachable templates are not
data-access evidence.

### 2.2 Inventory access-control surfaces

For every reachable data component, retain:

- source page/template/Web File;
- bound table and exact component name;
- operation evidence: read, create, write, delete, append, append-to, or relationship traversal;
- `entitypermissionsenabled` state for each Basic Form, Advanced Form step, and List;
- table permission scope, CRUD flags, relationships, and associated role IDs;
- active Web API settings, including explicit fields;
- webpage rule right, page ID, state/status, and role IDs;
- page ancestry because a Restrict Read rule can apply to descendants;
- standard or enhanced serialization format.

`right: 2` is a Restrict Read page rule and is relevant to visitor access. `right: 1` is a Grant
Change rule for content management; report it separately and do not infer table-data access from it.
Ignore inactive page rules when their state/status proves they are inactive, but include that
evidence in the report.

### 2.3 Run local schema validation

If every collected role, table permission, and site setting uses enhanced/normalized format, run:

```bash
node "${PLUGIN_ROOT}/scripts/validate-permissions-schema.js" --projectRoot "<projectRoot>"
```

The shared validator is authoritative for enhanced/normalized table permissions, site settings,
and web roles. Merge its findings using the SPA severity mapping.

If any target record uses standard format, do not run or merge the enhanced schema validator for
that inventory: it would interpret legitimate `adx_` fields as missing/unexpected enhanced fields.
Use the collector's normalized output and source files instead. Independently verify required IDs,
booleans, scopes, role references, parent chains, and duplicate IDs/names. The shared validator
does not authorize rewriting `adx_`-prefixed or aggregate records into enhanced format. State in
the report which checks used normalized local evidence instead of the enhanced schema validator.

## Phase 3: Resolve Dataverse Metadata

Use `pac env who` to establish the exact target environment. Traditional exports do not contain a
reliable environment URL, so display the resolved environment in the report.

Reuse the main workflow's deterministic scripts:

```bash
node "${PLUGIN_ROOT}/skills/audit-permissions/scripts/query-table-lookups.js" \
  --envUrl "<envUrl>" --table "<table>"

node "${PLUGIN_ROOT}/skills/audit-permissions/scripts/query-table-relationships.js" \
  --envUrl "<envUrl>" --table "<table>"
```

Query lookup metadata for tables with create/write operations and relationship metadata for
Contact, Account, Parent, `$expand`, FetchXML link-entity, and native-component relationships.
Resolve native Dataverse form and saved-view bindings when component YAML does not expose enough
operation or field evidence.

When Dataverse access is available and the collected inventory is entirely enhanced format, rerun
the shared schema validator with live relationship verification exactly as the SPA workflow
describes. For standard or mixed inventories, use the deterministic lookup/relationship scripts
against the normalized records instead. If auth or metadata queries fail, continue with local
evidence and identify the skipped checks. Never invent relationship names, entity-set names,
component modes, or field access.

## Phase 4: Run the Traditional Audit

Build the table inventory from the union of:

1. existing table permissions;
2. reachable Basic Forms;
3. reachable Advanced Form steps;
4. reachable Lists;
5. reachable Liquid/FetchXML and linked entities;
6. reachable Web API calls and Web API settings;
7. `.datamodel-manifest.json` entries that are corroborated by active site evidence.

Create one per-table task and reuse the main workflow's A-K checklist in the same order. Substitute
traditional evidence for SPA source-code evidence:

| Main check | Traditional evidence |
|---|---|
| A. Permission existence | Reachable native component, Liquid/FetchXML, or Web API operation versus table permissions |
| B. Web role association | Permission role IDs versus normalized roles and inherited page Restrict Read roles |
| C. Scope appropriateness | Native component filters, page audience, Liquid filters, relationships, and actual user ownership |
| D-G. CRUD flags | Form mode, Advanced Form step behavior, List actions, Liquid reads, and Web API HTTP methods |
| H/H2. Append and AppendTo | Dataverse lookup maps plus native form/step writes and `@odata.bind` |
| I. Parent chain integrity | Normalized parent IDs/relationships plus live relationship metadata |
| J. Related-table coverage | FetchXML link-entity, `$expand`, List/view relationships, and native component dependencies |
| K. Record and complete | Exact traditional file/component/page evidence |

### Traditional-only security checks

Add these checks without changing the SPA checklist:

1. **Native permission enforcement disabled**
   - If a reachable Basic Form, Advanced Form step, or List performs create/write/delete or exposes
     personal/sensitive data while `entitypermissionsenabled` is false, report a critical finding.
   - For verified public read-only reference data, report a warning and require explicit review.
   - Do not flag an unreachable downloaded component.
2. **Page and table role mismatch**
   - Resolve inherited Restrict Read rules through page ancestry.
   - If the active page audience and table-permission roles do not overlap, report a critical
     functional finding.
   - If table permissions grant materially broader roles than the page, report a warning, or
     critical when write/delete access is exposed to the broader role.
3. **Anonymous access drift**
   - Cross-check the Anonymous Users role, unrestricted pages, native components, Web API settings,
     and table permissions. Report anonymous write/delete access as critical unless exact evidence
     proves it is intentional and safely scoped.
4. **Component operation drift**
   - Report missing CRUD flags required by active Form/List/step actions as critical.
   - Report enabled create/write/delete privileges with no active caller as informational, subject
     to the same reachability caveat as the SPA unused-permission check.
5. **Web API fields and token safety**
   - Reuse the SPA wildcard-field critical finding and explicit-field rules.
   - For reachable `/_api/` calls, require anti-forgery handling and least-privilege fields.
6. **Page rule integrity**
   - Report active Restrict Read rules with missing pages, invalid role IDs, or no intended role as
     critical.
   - Report Grant Change rules separately; do not count them as visitor read protection.

After per-table checks, run the main cross-table validations plus:

- every reachable component has a resolved table and permission-enforcement posture;
- every page-rule role resolves to an existing normalized web role;
- page ancestry and inherited Restrict Read coverage are internally consistent;
- standard/enhanced format boundaries are retained in every proposed remediation.

## Phase 5: Generate the Report

Use the same `FINDINGS_DATA` and `INVENTORY_DATA` schema and the same mechanical renderer:

```bash
node "${PLUGIN_ROOT}/scripts/render-audit-report.js" \
  --output "<projectRoot>/docs/permissions-audit.html" \
  --data "<temporary-data-json>"
```

Use `siteName` from detected context or `website.yml`. Write under `<projectRoot>/docs/` for both
nested and directly opened PAC roots. If the default report already exists, use the same
non-overwriting descriptive-name behavior as the SPA workflow. Delete the temporary JSON after a
successful render and open the actual report path.

Include in the report:

- PAC format (`standard`, `enhanced`, `mixed`, or `unknown`);
- exact project root, site root, site identity, and target environment;
- active versus ignored/unreachable evidence;
- native component enforcement findings;
- page-rule and table-role cross-checks;
- skipped live checks and their reason;
- whether each suggested fix is safe for deterministic enhanced-format tooling or requires a
  maker/manual standard-format change.

## Phase 6: Present Findings and Offer Fixes

Record usage as `AuditPermissions` using the exact `projectRoot`; shared tracking resolves nested
or direct enhanced site-settings roots. If a standard site has only aggregate `sitesetting.yml`,
report that tracking was not written rather than changing its serialization.

Use the existing `audit-permissions:6.fix-offer` gate from the main skill. Do not add another
approval question.

When the user accepts fixes:

- For enhanced-format table permissions, invoke `table-permissions-architect` with
  `siteType: declarative`, exact `projectRoot`, exact `siteRoot`, tables, operations, role IDs,
  page/component evidence, relationships, and current serialization format.
- For standard `adx_`-prefixed permission records or aggregate role/page-rule/site-setting files,
  do not invoke enhanced-only creation scripts. Explain the exact Design Studio or guarded
  standard-format change required.
- Native Form/List/Advanced Form permission-enforcement changes and webpage access-rule changes are
  not table-permission-file fixes. Identify the owning record and required maker action; do not
  silently edit unrelated metadata.
- Keep informational cleanup suggestions separate from critical access fixes.

Declining the gate leaves only the generated report. No permissions, roles, components, page
rules, site settings, or Dataverse records are modified.

## Phase 7: Complete and Verify

Before completing:

1. Confirm every inventory table has a completed task.
2. Confirm every finding cites a concrete file, component, page, rule, or Dataverse result.
3. Confirm standard/enhanced fields were normalized only in memory and no source metadata changed.
4. Confirm the rendered report has no placeholder tokens.
5. Report live runtime behavior as unverified unless the user separately deploys and tests the
   site.

The normal `validate-audit.js` PostToolUse hook validates the report after the skill returns. Do
not run the hook directly; it expects hook JSON on stdin.
