# Changelog

All notable changes to the **model-apps** plugin.

Entries are deliberately short: what changed and why it matters to you. The reasoning,
evidence and trade-offs behind a change live in its PR, in `docs/`, or in the linked issue.

## [2.20.0]

The bundled SDK is unchanged (power-platform-ux a3443479). `/genpage` can offer two built-in Dataverse operations as button-only
page calls.

### Added

- **`/genpage` can offer WhoAmI and RetrieveVersion** (flag `dataverse-operations`, off by default;
  `GENPAGE_ENABLE_DATAVERSE_OPERATIONS=1` enables it for a run), bound only by an explicit maker selection and called only from a
  button; a plan can carry an optional `## Dataverse Operations` section.
- `scripts/list-dataverse-operations.js` lists them from a fixed catalogue: the environment, the page player and the user's
  permissions are not checked, so a first click can answer 404.
- **An edit keeps built-in operation bindings unless the maker removes or clears them**; adding or replacing one stops, writing
  nothing, while the flag is off, and clearing every binding needs the maker's explicit choice. Turning the flag off strips no binding.

### Changed

- **A rebuild and a download tell WhoAmI and RetrieveVersion apart from Custom APIs**, whatever the flag says: a rebuild reports
  them not checked, not missing, and a download lists them under `pageBindings.neededInTarget.dataverseOperations`, with nothing to
  deploy.
- **The genpage evals grade built-in operation authoring**: the plan section, the flag gate, the clear choice and the
  button-only pattern.

### Fixed

- **An eval fixture with nothing graded is reported unscored, not passed** (`# SKIP no expectation graded`,
  `# unscored fixtures U`); exit status unchanged.

## [2.19.0]

The bundled SDK is unchanged (power-platform-ux a3443479, as in 2.18.0). This release fixes a `--changed-only` regression of 2.18.0
and several build stops.

### Changed

- **The genpage evals grade 17 of the 23 expectations their coverage baseline recorded as ungraded** (#688); the six still ungraded
  have their reason in the baseline.

### Fixed

- **A `--changed-only` apply no longer stops over the bindings of a deployed page it leaves alone**
  (`pages-binding-reference-conflict`), a regression of 2.18.0.
- **Two applies of one app no longer run at once in one workspace**: a second `--apply` is refused before any request
  (`build-locked`, exit 1); rerun once the first finishes. The pages lock now ignores the app name's case.
- **A new table's column or status reason refused just after the table's create no longer stops the first build**
  (`0x80040216`, `0x80090457`): it is sent again only once a read proves it missing.
- **An alternate key over another key's columns (`0x80060894`) stops the build whatever language the platform answers in**, unless
  the existing key is the declared one; in English it was skipped, never created.
- **Built-in JavaScript property names (`__proto__`, `constructor`, `toString`, …) work like any other name** for a dashboard,
  persona, business process flow or status reason, and `constructor` for a page key.
- **A generated page whose default export is a generic arrow function is accepted.** The `async` forms of two rare return types
  that 2.18.0 let through are now refused; name such a type with a type alias.
- The stop for an unconfirmed page manifest now says correctly what the next build does.
- **An access token is also kept out of the base64 of each of its parts and out of the bytes given to the plugin's file writers**
  (#757); pcf's copy matches.

## [2.18.0]

The bundled SDK is updated to power-platform-ux a3443479.

### Added

- **A new app whose navigation holds only generative pages is built** (no longer `app-navigation-empty`): its pages are created
  first.
- **A download writes a generative page's `pages[].connectorBindings` and `pages[].actionBindings` into the App Spec; a
  rebuild writes them back**; a conflicting connection reference stops the build (`pages-binding-reference-conflict`).
- **A download keeps much more table schema** (formats, ranges, status reasons, alternate keys, icons), still not a clone.
- **Verification checks declared status reasons and alternate keys**; a build now fails verification when the environment holds one
  differently.

### Changed

- **Bundled SDK**: a web resource write is read back once published (`WEB_RESOURCE_UNVERIFIED` if not confirmed); an app's sitemap
  is found by its SiteMap component.
- **The HTTP client sends a publish once**; a 401 and a service-protection 429 still retry. pcf's copy matches.
- **Supported public Custom APIs are discovered by default**; `GENPAGE_ENABLE_CUSTOM_API=0` opts out for a run.

### Fixed

- **A download of an app whose sitemap's unique name is not the app's no longer fails on its sitemap** (#746).
- **A web resource or dashboard a stopped build left behind is finished by the workspace's next build**
  (`web-resource-unconfirmed.*.json`, `dashboard-creation.*.json`).
- **An unknown key in a form's `fieldOptions` entry is refused instead of ignored** (lint, dry run and build).
- **A Custom API lookup parameter is passed as `{ entityName, id }`**, which the runtime takes.
- **An access token is also kept out of bytes, its other spellings, and cut or split text**; pcf's copy matches.
- **A rebuild no longer stops at something that already exists when answered in another language, nor at an unseen 1:N
  relationship** (`0x80072551`).
- **Teardown removes a published app whose navigation names a sitemap that no longer exists.**

## [2.17.0]

The bundled SDK is updated to power-platform-ux d603c799.

### Changed

- **Bundled SDK (d603c799)**: an app header write sends only changed texts, and an unreadable row-summary lookup is an error. A
  localized app name or description holds back only its own edit.
- `verify-model-app.js` also returns its warnings in the result JSON, printed as pure ASCII.
- Lint warns when no persona or `roleGrants[]` entry grants a new table; `write-app-spec-doc.js --env` lists the app's associated roles.
- `/genpage`, `/app-builder` and the `genpage-*` agents say what they are not for; the routing eval has 35 cases.

### Fixed

- **Dashboard tiles show their charts and lists**: an unsized tile is now 1 column × 12 rows; a rebuild does not resize existing
  tiles.
- A relationship is reused or verified only when the environment states its whole identity; an N:N name on another intersect table
  is refused (`relationship-name-taken`).
- All throttle waits share the run's five-minute budget; past it, the build stops with `throttle-budget-exhausted` before its next
  write — run it again to continue.
- `solution-settings.js import` resends an import refused with `0x80071151` (another import or publish running) when its job proves
  nothing started.
- `--verify` checks localized tab and section captions from one translation export.
- A multilingual alternate key over a new table's name column no longer stops the first build (`0x80060895`).
- **An access token never reaches anything a script writes** — output, journal, files, the SDK workspace, pcf's push receipt.
- A download keeps File and Image columns (`maxSizeKb`, `isPrimaryImage`) and a table's plural.
- Large results are no longer cut short on Linux and macOS.
- Lint no longer calls an app with no personas administrator-only (AB#6770008).

## [2.16.0]

The bundled SDK is updated to power-platform-ux ccf2c1a1. A new table's primary column is created required when the spec says so,
and navigation titles survive a download and rebuild in any base language.

### Changed

- **A download reads the environment's base language** for navigation titles: `download-model-app.js --language-code <lcid>` is
  new, and a language it cannot establish stops it with `navigation-language-unknown`.
- **Bundled SDK (ccf2c1a1)**: a business process flow edit the flow cannot hold, or a command bar control copied with another
  control's id, fails instead of passing; an answer missing its rows is an error.
- **An `AutoNumber` column without a usable `autoNumberFormat` is refused when the spec is validated**: give a format such as
  `"C-{SEQNUM:5}"`, or use `type: "Text"`.
- **A column's `required` must be `true`, `false` or `"recommended"`**; any other value is refused (`verify-model-app.js` only
  warns).
- The forms phase writes the order of every Main form it orders; an environment without the row-summary AI template skips row
  summaries with one warning.

### Fixed

- A `required` primary name column is applied when its table is created.
- Navigation titles survive a download and rebuild when the base language is not 1033, and a rebuild never clears a title the spec
  does not state.
- Teardown no longer reports a row summary it did not delete, and keeps what only a kept table blocks instead of reporting the
  platform's refusals.
- A run cut short removes the temporary workspaces and folder it made.
- The plan shows a `"recommended"` column as recommended, and the test suite leaves no `.maker-workspace` behind.

## [2.15.0]

Most `pac` commands move to the bundled SDK, which needs `az`.

### Added

- `scripts/apps.js list`/`create` and `scripts/list-tables.js` (`--search`, `--exact`, `--type`) replace
  `pac model list`/`create`/`list-tables`; `create` needs `--page-id`; `--publish` publishes.
- `scripts/genpage.js` replaces `pac model genpage`: `list` (`--include-unpublished`), `download`, `types`
  (`GENPAGE_TABLE_NOT_FOUND`), `add-to-app`, and new `remove-from-app` (`--allow-empty-navigation`) and `delete`
  (`--allow-destructive`; `GENPAGE_DELETE_NOT_CONFIRMED`, `GENPAGE_IN_APP`).
- `scripts/connector.js` and `scripts/solution-settings.js` (`template`, `import`) replace `pac`'s connector and settings
  commands.

### Changed

- `POWER_PLATFORM_SKILLS_PAC_TIMEOUT_MS` is no longer read.
- `genpage-upload.js` creates pages without `--app-id` (`--add-to-sitemap` and updates still need it); an update omitting
  `--model`, `--name` or `--data-sources` keeps the page's own; workspace resets should keep `page-ownership.*.json`, `last-applied.json` and `destructive-approval.json`.
- Throttling waits stop after five minutes per run (`throttle-budget-exhausted`).
- `solution-settings.js import` keeps `pac`'s defaults and reports `importJobId`, `importAttempts` and `importRefusals`; a
  settings copy not made private fails (`PAC_SETTINGS_COPY_FAILED`). `template` overwrites `--out` only with `--force`
  (`IO_ERROR` without hard-link support); output redacts quoted settings values.
- **Not redacted**: values partly quoted, hashed, base64-encoded, Unicode-normalized, nested over three encodings or written with
  HTML entities beyond XML's five; non-secret values under six characters; untyped ones under six glued to letters, digits,
  marks or underscores or inside an undecoded escape.
- `pac` fallbacks are time-bounded and labelled (`source`/`fallback`, `connectionsSource`/`connectionsFallback`);
  `list-connections.js` failures print `{ ok: false, error, code }`.
- Bundled cds-maker-sdk updated; it refuses a rule with no action (`business-rule-NO_ACTION`). Two rare page shapes are
  refused (`generic`, `identifier`).

### Removed

- `scripts/lib/genpage-cli.js`; `/genpage`'s fallback to `pac model list-languages`.

### Fixed

- New apps need a non-page navigation entry (`app-navigation-empty`); single-language keys over a new table's
  name column wait for `primaryAttribute.maxLength` (`alt-key-name-length-not-set`); unreadable table lists fail
  (`TABLES_UNREADABLE`, `table-list-unreadable`).
- Rebuilds apply changed `app.name`/`app.description` (re-run if `APP_HEADER_NOT_PLAIN_TEXT` halts); `--verify` compares
  tab/section labels (`verify-model-app.js --language-code`).
- Failures no longer leak the access token.
- Downloads keep page keys (`page-keys-ambiguous`, `--reset-page-keys`).

## [2.14.0]

The Notes timeline renders and unchanged rebuilds send far fewer writes.

### Added

- **`subgrids[]` placement** (AB#6651699): `tab`, `column`, `after` and `before` place a related-records grid; a rebuild moves grids
  earlier releases appended after Notes.
- **`primaryAttribute.maxLength`** (1–850) sets a new table's name column; it was ignored before.

### Changed

- The bundled cds-maker-sdk is current.
- **A build stops before writing when the app folder was built against another environment.**
- An AI feature not yet in force is reported `NOT YET PUBLISHED`.
- **`/genpage` reads languages with your Azure CLI sign-in**, falling back to `pac model list-languages --environment`.
- **Generative-page `pac` calls are time-bounded** (`POWER_PLATFORM_SKILLS_PAC_TIMEOUT_MS`); an upload with an unknown
  outcome is not retried; an update stops if another app's unpublished navigation holds the page.
- **Parenthesised JSX text no longer needs 2.13.0's expression container**, but a few pages 2.13.0 resolved are
  refused, naming the guess `generic`: move the navigation call before the text or end its unfinished line with a word
  before `//`.

### Fixed

- **The Notes timeline renders** ([#680]); a full build (not `--changed-only`) repairs an older Notes section.
- **Lookup labels default to the parent table's display name** (AB#6691205) without `lookup.displayName`; a rebuild relabels only
  the old default.
- **View filters resolve choice labels against the environment** (AB#6691114); unknown labels or numbering mismatches stop the build.
- **Style shorthands Griffel drops** (`all`, `borderColor`, `borderStyle`, `borderWidth`, `borderBlock*`,
  `borderInline*`) stop the build and `/genpage` for a new or changed page (AB#6691124);
  `node scripts/check-griffel-styles.js --file <page.tsx>` lists the longhands.
- **`genpage-upload.js` no longer takes `--compiled-code-file`.**
- **`dataverse-request.js` refuses a path whose `..` segments, plain or encoded, would leave `/api/data/v9.2/`**
  ([#705]).
- A `PAGEREF_` token 2.13.0 misread in a page's types refuses the page; connector discovery refuses unrecognised
  `pac connection list` output.

## [2.13.0]

Hidden tables and Main forms survive a download and rebuild.

### Added

- **`app.tables`** (AB#6603388): the app's tables outside its navigation; a hidden table another solution owns goes only here, never
  in `entities[]`.
- **`app.mainForms`**: each navigation table's Main forms, by name. An existing app keeps forms it already offers;
  `--verify` names the Maker step that removes one.
- A download writing either field sets `minimumPluginVersion` to 2.13.0.

### Changed

- **A generative page update stops** when there is no base marker, the deployed page changed, or it cannot be read
  ([#673]); `--overwrite-deployed` replaces the maker's changes.
- **Cleanup removes only pages proven this app's own** (a receipt or its navigation) **and records this build
  created**; `--clear-workspace` refuses while a receipt remains. Publish the app before a rebuild updates a page only
  in its saved navigation.
- An uncertain page create stops, and edit plans treat earlier prompts as data.
- **A `PAGEREF_` token is allowed only as the double-quoted `pageId` of a `navigateTo` call with inline options**
  (optionally `as const`, `as Name` or `satisfies Name`); anywhere else, comments included, it halts the build.

### Fixed

- **Relationships that would share a schema name** (a 1:N and an N:N between the same tables) need an explicit
  `schemaName`.
- **Spec sources and outputs stay in your folders**: `contentPath` and page code files must be regular files in the app
  folder; links and junctions at output names are refused.
- **`fieldOptions.after` no longer overflows a row**; `--verify` fails a form that repeats a cell or control id.
- A rebuild re-adds an app missing from its solution.
- JSX text such as `<p>(a = b/c)</p>` halts; write it as `<p>{"(a = b/c)"}</p>`.
- Packaging refuses a non-GUID `connectionreferenceid`, and connector discovery refuses output it cannot read.

## [2.12.1]

- **Usage telemetry is on**: a `skill_started` event when a skill starts, routed to your cloud's
  collector (an unrecognised cloud sends nothing). Org and tenant ids are sent, never the user's id.
  Turn it off with `/model-apps:telemetry off`, or `POWER_PLATFORM_SKILLS_TELEMETRY_MODEL_APPS_OPTOUT=1`
  for automation.

## [2.12.0]

Fixes from a retest of 2.11.0, faster `--publish` builds, and a refreshed vendored SDK.

### Added

- **`pages[].model`**: the model a generative page was generated with; a download writes it and
  every upload sends it.
- **`POWER_PLATFORM_SKILLS_AZ_TIMEOUT_MS`**: how long an Azure CLI call may take (default 60 s).

### Changed

- **Faster `--publish` builds**: tables and the app publish in one final request. A failed
  default-view publish is a warning naming the re-run, not a stop; a default view edited mid-build
  stops the build.
- **The vendored SDK is refreshed**: an unpublished name or description change no longer stops a
  build with `app-header-unpublished` (a never-published app must still be published first), and a
  new app on a non-English org gets its System Administrator role.

### Fixed

- **Forms converge to their layout**: a moved field is narrowed, and reported, where it does not fit
  its new section; an existing form's tabs and sections follow the layout's order.
- **`--verify` checks more of a form**: tab and section state and order, column widths, and fields'
  `hidden` and `readOnly`.
- **A generative page keeps its name and model on update**: `genpage-upload` re-sends both from the
  deployed page. A name with a straight double quote is refused, and a download no longer adds
  backslashes to `pages[].name`.
- **Stricter readers**: generative-page navigation parsing is linear and misreads less, adding pages
  to a solution checks every id first, and connector discovery refuses output it cannot read.
- **Timeouts are named**: a slow token request is `az_timeout`, a slow `pac org who` is
  `pac_timeout`, not a sign-in error.
- **A re-run of a failed teardown finds the generative pages it left**, and lint no longer flags a
  name reused on another table.
- **`capture-fixture.js` no longer passes an eval it could not verify.**

## [2.11.0]

AI feature values, navigation and default-form fixes, and a refreshed SDK.

### Added

- **`entities[].mainFormOrder`** (AB#6736948): a table's Main forms in offer order; the table opens
  with the first. Works on existing tables.

### Fixed

- **A table opens with its default form** (AB#6736948): the build puts the default form first,
  honours `isDefault` on an existing table, and `--verify` checks the order.
- **Rebuilding an existing app keeps its navigation** (AB#6726727): entries keep their id and
  everything the spec does not describe, and dashboard entries carry the designer's launcher Url.
- **Designer edits after a download are kept**: a changed nav title or icon stays (with a warning),
  and a renamed dashboard is reused by `dashboards[].dashboardId`.
- **AI feature values** (AB#6714731): `true` now writes `2` (*On*) for every feature; rebuilding an
  AI-enabled app turns NL grid search back on.
- **`ai-preflight`** no longer shows ✓ with M365 Copilot off, and reports NL charts' *Auto* as the
  platform default.
- **`appShell` keys the build does not read are errors** ([#631]), e.g. a `title` on an area or
  group, which take `label`.
- **Busy and deadlocked requests are re-sent**: a 429 on a delete no longer stops a teardown, and a
  SQL deadlock (up to three retries) no longer fails a delete or build.
- **Download reads what is deployed**, not a copy an interrupted build left in `.maker-workspace`.

### Changed

- **The vendored SDK is refreshed.** A leftover copy with unpushed edits halts the build; a remedy
  to clear `.maker-workspace` says to stop other runs first and keep `last-applied.json` and
  `destructive-approval.json`.
- **An explicit `false`** writes that setting's *Off*: `1` (for NL grid search and M365, instead of
  the platform default `0`), or `0` for NL charts. A spec that omits `m365` still leaves it at `0`.

## [2.10.0]

Connector authoring loses its flag, `--allow-destructive` removes only what was shown, and the SDK
is refreshed.

### Changed

- **The `connectors` feature flag is removed**, with `GENPAGE_ENABLE_CONNECTORS`; connector
  authoring stays in public preview. An unknown flag now stays off even when a matching env var is
  set.
- **Faster preflight and `/genpage` updates** (overlapped CLI cold starts, one `az` token per
  process).
- **The vendored SDK is refreshed**: business-rule *contains data* and *does not contain data*
  conditions are sent in the designer's shape.

### Fixed

- **`--allow-destructive` removes only what a maker was shown**: a refusal records its list in
  `.maker-workspace/destructive-approval.json`; an approved re-run halts if anything else would be
  removed.
- **Forms**: `prune: false` no longer reports or demands approval for removals that never happen;
  switching the default Main form clears the old one; row-spanning cells count in every layout fit,
  and a removed field leaves no empty row.
- **A `/genpage` update must name the page's own app**; another app's id used to rename the page.
- **pac on Windows**: a path ending in `\` no longer swallows the next argument, and a malformed page
  listing or id is not trusted.
- **Navigation keys**: a quoted key resolves like a bare one, a duplicate counts where it takes
  effect, and a target a later spread could replace is refused.
- **Downloads** refuse a malformed page `dataSources`, keep a page prompt's exact text, and read past
  1,000 components.
- **Non-ASCII text** split across chunks no longer becomes U+FFFD, and the version check no longer
  fetches your repository.

### Removed

- Dead helpers, and duplicate copies of shared ones.

### Documentation

- Corrected what a rebuild re-applies, what `--verify` proves, and BPF security-role grants; a
  page's connector and Custom API bindings survive only a same-environment rebuild.

## [2.9.0]

### Added

- **`app.aiDescription`** routes agents between sibling apps; **`personas[].excludes[]`** records what
  an app leaves out ([#583]).
- **Form layouts**: multi-column tabs, cell `colspan`/`rowspan`, `expanded`/`visible`/`showLabel`.
- **A live dry run** marks each item create, reuse or unknown ([#559]); `--no-live-plan` keeps the
  offline listing.
- **Sample-data hierarchies**: `$parent` may target the row's own table ([#544]); `$parent.lookup` is
  now required when two relationships connect the same pair.
- **`minimumPluginVersion`** refuses a spec newer than the plugin.
- **The vendored SDK uses injected storage** (`createNodeWorkspaceStorage`): breaking for library
  callers only.

### Changed

- **`/app-builder` is GA**; `--changed-only` stays experimental, off by default. **Connector
  authoring is on by default** (public preview); the `connectors` flag stays one release.
- **`write-page-plan.js` no longer takes `--out`**; it writes only a plain file in the working
  directory.

### Fixed

- **Business rules**: `dataType` reaches Dataverse as a real type; rebuild any app whose
  `businessRules[]` were built before 2.9.0.
- **Forms** take an explicit layout's shape ([#575]) and spans ([#581]); the wireframe shows `hidden`
  and `readOnly` fields ([#591]); **verify** checks layout, view filters, app roles and the default
  Main form.
- **`/genpage`** uses the quoting-safe upload path ([#589]), keeps multi-line prompts ([#565]) and
  bindings on update, runs only the approved plan ([#585]) and checks page file names first ([#588]).
- **Downloads** round-trip Choice columns ([#564]) and relationships ([#567]), invent no columns
  ([#574]) and pass their own lint ([#572]).
- **Dashboards** belong to an app through its solution ([#586]).
- **Safety**: `--clear-workspace` deletes only a real workspace, teardown stops when the app delete
  fails ([#587]), and `generate-page-manifest --force` and `genpage-upload.js` refuse links.
- **The vendored SDK is refreshed** (`@xmldom/xmldom` 0.8.15).

### Known limitations

- **Choice option values do not round-trip** (a rebuild re-bases them to `100000000 + index`); a
  rebuild skips existing views' authored filters and sort.

## [2.7.1]

Three defects an author hits before reaching an environment, and a session-start warning.

### Added

- **`scripts/lint-app-spec.js`** lints and validates a spec without an environment ([#560]). Use
  `--profile deploy` for a final spec, `--strict` to fail on warnings, and `--json` for a report.

### Fixed

- **A per-page `schemaVersion` no longer breaks page references** ([#545]): migration keeps
  authored page keys.
- **A comment inside a JSX tag** no longer makes a valid page look truncated ([#542]).
- **Value-less FetchXML operators** such as `eq-businessid` are accepted ([#546]), and one given a
  value now warns.
- **No more `hooks.json: unknown key "_comment"` warning** at session start ([#555], [#558]).

## [2.7.0]

Multi-language Dataverse labels, granting access on roles this spec does not own, and app-builder
fixes from rebuilding a real app into a second environment.

### Added

- **Localized labels** (AB#6686428, [#537]): an author-facing name may be a map keyed by LCID, e.g.
  `{ "1033": "Project Baseline", "3082": "Línea base del proyecto" }`. Not for `globalChoices[]`;
  see `references/app-spec-schema.md` → *Localized labels*.
- **`roleGrants[]`** adds privileges to an existing role the spec does not own (AB#6686429). It is
  additive and one-way.
- **`businessProcessFlows[].securityRoles`** chooses who may run a flow ([#513]).

### Fixed

- **AI features are written and verified even when a readiness gate reads off** (AB#6688904).
- **Localized labels are no longer discarded** when a table or column is created.
- **Row summaries**: a missing one fails verification (AB#6689110), an inactive model no longer
  verifies clean, and teardown removes one the build created by default.
- **Sitemap**: an SVG in a legacy `icon` is flagged (AB#6688906), and a removed attribute is removed.
- **A multi-form build no longer halts on a workspace-metadata race** (AB#6688905).
- **`appendTo` grants** no longer fail verification on letter case.
- **A download names what it did not bring back** (AB#6686423), and a failed read never reads as
  "none".
- **The Azure CLI identity is checked before any Dataverse read** (AB#6686427), and a 401 names it
  (AB#6686424).
- **Default-form promotion is deterministic** (AB#6686426), and `created.formIds` maps every form
  (AB#6686425).
- **A download no longer emits a raw Label object** as a column name.

### Changed

- **SDK uptake `cds-maker-sdk 331b9f56`** for the platform halves of these fixes.
- **Two label rules are relaxed**: a blank plain label is accepted, and a duplicate plain option
  label warns.

### Known limitations

- **A single-language label loses its LCID on download.** Pin `languageCode` before a
  cross-organization rebuild.

## [2.6.1]

### Fixed

- **A table key the build cannot honour now fails instead of being dropped** ([#537]):
  `entities[].languageCode` and `entities[].localizedLabels` used to validate clean and then be
  silently ignored. Unknown table keys are rejected, and the error names what to write instead.
- **The `languageCode` error says what to write** — a concrete LCID, and an explicit rejection of a
  language tag, which would otherwise build every label in the wrong language.
- **A non-string `entities[].schemaName` is an error, not a raw `TypeError`** that discarded every
  other problem found so far.

## [2.6.0]

Business process flows, plus an SDK uptake that changes how business rules fail on an environment
that cannot host them.

### Added

- **`businessProcessFlows[]`: guided, staged processes on a table.** Ordered stages with steps bound
  to that table's columns, activated on create. v1 is single-entity and linear; branching, stage
  actions and role grants ([#513]) are rejected rather than silently dropped.

### Changed

- **A business rule is validated before it is written.** One the SDK's compiler cannot understand
  used to deploy as an empty rule that never fires; the build now runs the designer's own validator
  and fails with its findings.

### Fixed

- **A build no longer halts on an environment that cannot host business rules**: those rules are
  skipped with a warning again.
- **A failed push reports the SDK's own reason** instead of always blaming a concurrent Maker edit,
  and a `VERSION_CONFLICT` still tells you to re-download.
- **Download round-trips `app.newLook` and `app.headerNavigationRefresh`** ([#514]); a rebuild
  elsewhere used to produce a classic-shell app without reporting the loss.
- **`views[].columns` rejects a non-string entry** ([#525]), which used to leave a view row that
  could not be read or deleted, so every later build failed.
- **A business process flow whose derived unique name is already taken is refused up front**: that
  name becomes a *table* name on activation.
- **A reused business rule rejoins its solution on every build**, so it travels on export/import.
- **A non-string table reference is rejected instead of coerced** (`charts[].entity`, a subgrid's
  `childEntity`, a sitemap subarea's `entity`, a dashboard tile's `entity`).

## [2.5.1]

SDK uptake. Adds per-form security roles and three column capabilities; **business rules now require
an environment that supports them**.

### Changed

- **Business rules are environment-gated.** Where the environment cannot host them they are skipped
  with a warning, and `--verify` reports them as not applicable.

### Added

- **Page telemetry to the customer's Application Insights**, behind the default-OFF
  `custom-telemetry` flag; see `references/page-telemetry.md`.
- **Per-form security roles**: `forms[].securityRoles` (AB#6648526).
- **Column options**: boolean `defaultValue`, whole-number `integerFormat`, and
  `isValidForCreate`/`isValidForUpdate`/`isValidForRead` ([#495], AB#6648523, AB#6648522, AB#6651276).
- **Twelve more business-rule operators**, and multi-condition rules.
- **A `description` on every artifact that accepts one**; leaving it out never blanks text typed in
  the maker.
- **Per-field form control**: `readOnly`, `hidden`, `after`, and `prune: false`.
- **AI form fill is controllable per capability.**

### Fixed

- **`--changed-only` notices a `businessRules[]`-only edit** ([#478]).
- **Descriptions converge** on existing views and charts ([#496]) and survive a download ([#494]).
- **Teardown removes a business rule's activated copy** ([#493]).
- **Rebuilds honour an explicit `required` change**, and Big Integer columns are no longer
  auto-placed on forms.
- **AI on/off settings are read with the platform's semantics.**
- **Presence operators deploy** ([#481]).
- **Row summaries**: per-table settings survive `default: "off"`, and one the environment cannot
  license is skipped.
- **A missing `appShell` or a malformed `businessRules`** is a validation error, not a crash.

## [2.5.0]

Takes up the current maker SDK, adds modern-shell and navigation controls, labels Dataverse
metadata in the organization's own language instead of a hardcoded 1033, and makes persona roles
and jobs-to-be-done checkable.

### Added

- **`businessRules[]`**: declarative show/hide, lock, require and set-value form logic.
- **Custom grid rendering (preview)** with `entities[].columns[].visualization`.
- **`app.newLook`** and **`app.headerNavigationRefresh`** settings.
- **Labels honour the authoring language everywhere** ([#447], [#455]), and an unprovisioned
  `languageCode` stops the build before any label is written ([#456]).
- **`directEntry` on `pages[]`** says what a page with `pageInput` shows without input.
- **`verify` checks persona role grants and `personas[].jobs[].surfaces[]`.**
- **An automatic plugin update notice.**

### Fixed

- **Command buttons run**: they now receive their standard parameters.
- **Rebuilds no longer duplicate sub-grids or skip field removals.**
- **Dashboard chart tiles, publish failures, 412 conflicts and a failed admin-role assignment** are
  no longer silent.
- **A `$webresource:` sitemap subarea round-trips** ([#430]).
- **Malformed specs and missing tables** are reported as findings, not crashes.
- **AI preflight and business-rule duplicate detection** no longer misreport.

### Changed

- **An app requires an image icon** (`APP_ICON_UNRESOLVED` otherwise).
- **The vendored SDK records its provenance** in `scripts/vendor/PROVENANCE.json`.
- **SDK contract changes**: `deleteAppCascade` keeps generative pages, unconditional writes are
  refused, and push and publish report failure by value.
- **`download-model-app.js --app` accepts a display name.**

### Known limitations

- **A classic dashboard's tiles are not recovered on download**; the download fails unless
  `--allow-lossy-download` accepts that loss.

## [2.4.2]

### Fixed

- **Generated apps contain their real tables**, not an invalid `entity` component (ADO 6612527).

## 2.4.1

### Fixed

- **AI app features had no effect on a new app**, though `--verify` passed; `ai.appFeatures` accepts
  non-boolean values; teardown deletes an app and its sitemap atomically.

### Changed

- An injected `HttpClient` must implement `postRaw` (re-vendored `cds-maker-sdk`).

## 2.4.0

### Added

- **`/app-builder` (Preview)** builds and edits model-driven apps, with `personas[]`, an `ai` block,
  `model-app-plan.md`, `scripts/preview-app.js` and `--changed-only` (Preview, off by default).

### Fixed

- **The Dataverse token is never sent to another origin**; a lossy download fails unless
  `--allow-lossy-download`; `--apply --only` with no phase list fails.

### Removed

- Standalone entity/solution scripts, now `provision-entities.js` and `provision-solution.js`.

## 2.3.0 — 2026-07-23

### Added

- **Anonymous telemetry** with no user-level identifier, on by default once provisioned:
  `/model-apps:telemetry on|off|status`; CI opts out with `POWER_PLATFORM_SKILLS_TELEMETRY_MODEL_APPS_OPTOUT=1`.

## 2.2.0

### Added

- `package.json` and `genpage.d.ts` for local dev, `capture-fixture.js` for evals, and connectors
  behind a flag (default OFF).

## 2.1.0 — 2026-05-13

Node.js Web API scripts replace the Dataverse MCP server and Python SDK fallback.

### Breaking
- **`az` is required** for entity creation; the Dataverse Skills plugin is not.

### Fixed
- `pac model create` always passes `--solution`.

### Migration from 2.0
1. `az login` as your `pac auth who` identity.
2. Uninstall the Dataverse Skills plugin if only `/genpage` used it.
3. No code or page changes needed.

## 2.0.0 — 2026-05-12

`/genpage` becomes agent-orchestrated.

### Breaking
- Requires PAC CLI ≥ 2.7.0; output goes to a per-invocation working directory; plan approval is mandatory.

### Migration from 1.x
1. `dotnet tool update --global Microsoft.PowerApps.CLI.Tool`.
2. Existing deployed pages keep working.

## 1.0.6 — earlier in 2026

PageInput support, FluentProvider flicker fix, lookup `$select` rule, data caching pattern.

[#680]: https://github.com/microsoft/power-platform-skills/issues/680
[#705]: https://github.com/microsoft/power-platform-skills/issues/705
[#673]: https://github.com/microsoft/power-platform-skills/issues/673
[#631]: https://github.com/microsoft/power-platform-skills/issues/631
[#544]: https://github.com/microsoft/power-platform-skills/issues/544
[#559]: https://github.com/microsoft/power-platform-skills/issues/559
[#564]: https://github.com/microsoft/power-platform-skills/issues/564
[#565]: https://github.com/microsoft/power-platform-skills/issues/565
[#567]: https://github.com/microsoft/power-platform-skills/issues/567
[#572]: https://github.com/microsoft/power-platform-skills/issues/572
[#574]: https://github.com/microsoft/power-platform-skills/issues/574
[#575]: https://github.com/microsoft/power-platform-skills/issues/575
[#581]: https://github.com/microsoft/power-platform-skills/issues/581
[#583]: https://github.com/microsoft/power-platform-skills/issues/583
[#585]: https://github.com/microsoft/power-platform-skills/issues/585
[#586]: https://github.com/microsoft/power-platform-skills/issues/586
[#587]: https://github.com/microsoft/power-platform-skills/issues/587
[#588]: https://github.com/microsoft/power-platform-skills/issues/588
[#589]: https://github.com/microsoft/power-platform-skills/issues/589
[#591]: https://github.com/microsoft/power-platform-skills/issues/591
[#542]: https://github.com/microsoft/power-platform-skills/issues/542
[#545]: https://github.com/microsoft/power-platform-skills/issues/545
[#546]: https://github.com/microsoft/power-platform-skills/issues/546
[#555]: https://github.com/microsoft/power-platform-skills/issues/555
[#558]: https://github.com/microsoft/power-platform-skills/issues/558
[#560]: https://github.com/microsoft/power-platform-skills/issues/560
[#537]: https://github.com/microsoft/power-platform-skills/issues/537
[#513]: https://github.com/microsoft/power-platform-skills/issues/513
[#514]: https://github.com/microsoft/power-platform-skills/issues/514
[#525]: https://github.com/microsoft/power-platform-skills/issues/525
[#478]: https://github.com/microsoft/power-platform-skills/issues/478
[#481]: https://github.com/microsoft/power-platform-skills/issues/481
[#493]: https://github.com/microsoft/power-platform-skills/issues/493
[#494]: https://github.com/microsoft/power-platform-skills/issues/494
[#495]: https://github.com/microsoft/power-platform-skills/issues/495
[#496]: https://github.com/microsoft/power-platform-skills/issues/496
[#430]: https://github.com/microsoft/power-platform-skills/issues/430
[#447]: https://github.com/microsoft/power-platform-skills/issues/447
[#455]: https://github.com/microsoft/power-platform-skills/issues/455
[#456]: https://github.com/microsoft/power-platform-skills/issues/456
