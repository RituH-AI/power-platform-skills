const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { validateSiteSettings } = require('../lib/site-settings-validator');
const { validateTablePermissions } = require('../lib/table-permissions-validator');
const { validateWebRoles } = require('../lib/web-roles-validator');
const { createTempDeclarativeSite, writeProjectFile } = require('./test-utils');

const pluginRoot = path.resolve(__dirname, '..', '..');

function runNode(scriptPath, args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd,
    input: options.input,
    encoding: 'utf8',
  });
}

test('integrate-webapi declares request-focused and discovery traditional modes', () => {
  const skill = fs.readFileSync(
    path.join(pluginRoot, 'skills', 'integrate-webapi', 'SKILL.md'),
    'utf8'
  );
  const reference = fs.readFileSync(
    path.join(
      pluginRoot,
      'skills',
      'integrate-webapi',
      'references',
      'traditional-site-workflow.md'
    ),
    'utf8'
  );

  assert.match(skill, /siteType: "declarative"/);
  assert.match(skill, /traditional route supports request-focused and discovery invocation/);
  assert.match(reference, /Request-focused mode/);
  assert.match(reference, /Discovery mode/);
  assert.match(reference, /selectable integration opportunities/);
});

test('traditional workflow is native-first and approval-gated', () => {
  const reference = fs.readFileSync(
    path.join(
      pluginRoot,
      'skills',
      'integrate-webapi',
      'references',
      'traditional-site-workflow.md'
    ),
    'utf8'
  );

  assert.match(reference, /Prefer an existing Basic Form, Advanced Form,\s+List, or Liquid\/FetchXML/);
  assert.match(reference, /Custom Web API interaction required/);
  assert.match(reference, /Valid no-change result/);
  assert.match(reference, /No local\s+or Dataverse writes occur before approval/);
  assert.match(reference, /Do not create SPA files/);
  assert.match(reference, /author-web-file/);
});

test('SPA workflow keeps its existing prompts, gates, and task contract', () => {
  const skill = fs.readFileSync(
    path.join(pluginRoot, 'skills', 'integrate-webapi', 'SKILL.md'),
    'utf8'
  );
  const permissionsArchitect = fs.readFileSync(
    path.join(pluginRoot, 'agents', 'table-permissions-architect.md'),
    'utf8'
  );
  const settingsArchitect = fs.readFileSync(
    path.join(pluginRoot, 'agents', 'webapi-settings-architect.md'),
    'utf8'
  );
  const agentsGuide = fs.readFileSync(path.join(pluginRoot, 'AGENTS.md'), 'utf8');
  const readme = fs.readFileSync(path.join(pluginRoot, 'README.md'), 'utf8');

  assert.ok(
    skill.indexOf('perform the existing SPA project lookup first')
      < skill.indexOf('node "${PLUGIN_ROOT}/scripts/lib/detect-project-context.js"')
  );
  assert.match(
    skill,
    /Only when that existing SPA lookup finds no `powerpages\.config\.json`, run:/
  );
  assert.match(
    skill,
    /Integrates Power Pages Web API into a site's frontend code with proper permissions and\s+deployment\. Orchestrates the full integration lifecycle: code integration, table permissions\s+setup, and deployment for Dataverse CRUD operations\./
  );
  assert.ok(skill.includes(
    'Look for `powerpages.config.json` in the current directory or immediate subdirectories to find the project root.'
  ));
  assert.ok(skill.includes(
    'Final say on which tables get Web API integration code (client, types, services, hooks).'
  ));
  assert.ok(skill.includes(
    'Analyze this Power Pages code site and propose table permissions. The following tables have been integrated with Web API: [list of tables integrated in Phase 4].'
  ));
  assert.ok(skill.includes(
    'Analyze this Power Pages code site and propose Web API site settings. The following tables have been integrated with Web API: [list of tables integrated in Phase 4].'
  ));
  assert.ok(skill.includes(
    '| Implement integrations | Implementing Web API integrations | Invoke webapi-integration agent for first table (creates shared client), then remaining tables in parallel, verify output, git commit |'
  ));
  assert.ok(skill.includes(
    'When the sentinel is absent**: proceed exactly as today (full CRUD, full interactive flow, auto-commit, deploy prompt).'
  ));

  assert.ok(permissionsArchitect.includes(
    'Check that the site has been deployed at least once by looking for the `.powerpages-site` folder.'
  ));
  assert.ok(permissionsArchitect.includes(
    'If no manifest exists, analyze the source code to infer which tables need permissions:'
  ));
  assert.ok(settingsArchitect.includes(
    'If no manifest exists, analyze the source code to infer which tables need Web API access:'
  ));
  assert.ok(settingsArchitect.includes(
    'Do NOT use `Write` or `Edit` to create YAML files in `.powerpages-site/`.'
  ));
  assert.match(agentsGuide, /least-privilege table-permissions plan/);
  assert.match(
    agentsGuide,
    /Checks for `\.powerpages-site` to verify SPA deployment/
  );
  assert.match(
    agentsGuide,
    /`src\/shared\/services\/` or `src\/services\/` with `\/_api\/` endpoint references/
  );
  assert.match(
    agentsGuide,
    /Gracefully exits 0 when no integration files are\s+detected \(not an integration session\)/
  );
  assert.match(
    readme,
    /components using mock data, placeholder fetch\s+calls, or hardcoded arrays/
  );
  assert.match(
    readme,
    /processes the first table\s+sequentially because that creates the shared client, then processes remaining tables in parallel/
  );
  assert.match(readme, /upload your own permissions diagram instead/);
});

test('metadata creation scripts support a direct traditional PAC root', (t) => {
  const siteRoot = createTempDeclarativeSite(t);
  const roleId = '997e7996-e241-4117-9c09-28e90a1fcdbc';

  const settingResult = runNode(
    path.join(pluginRoot, 'scripts', 'create-site-setting.js'),
    [
      '--projectRoot', siteRoot,
      '--name', 'Webapi/cr123_item/enabled',
      '--value', 'true',
      '--description', 'Enable item API',
      '--type', 'boolean',
    ]
  );
  assert.equal(settingResult.status, 0, settingResult.stderr);
  assert.ok(JSON.parse(settingResult.stdout).filePath.startsWith(path.join(siteRoot, 'site-settings')));

  const permissionResult = runNode(
    path.join(pluginRoot, 'scripts', 'create-table-permission.js'),
    [
      '--projectRoot', siteRoot,
      '--permissionName', 'Items - Authenticated Read',
      '--tableName', 'cr123_item',
      '--webRoleIds', roleId,
      '--scope', 'Global',
      '--read',
    ]
  );
  assert.equal(permissionResult.status, 0, permissionResult.stderr);
  assert.ok(
    JSON.parse(permissionResult.stdout).filePath.startsWith(path.join(siteRoot, 'table-permissions'))
  );

  const roleResult = runNode(
    path.join(pluginRoot, 'skills', 'create-webroles', 'scripts', 'create-web-role.js'),
    [
      '--projectRoot', siteRoot,
      '--name', 'Portal Members',
      '--authenticated',
    ]
  );
  assert.equal(roleResult.status, 0, roleResult.stderr);
  assert.ok(JSON.parse(roleResult.stdout).filePath.startsWith(path.join(siteRoot, 'web-roles')));
});

test('schema validators inspect a direct traditional PAC root', (t) => {
  const siteRoot = createTempDeclarativeSite(t);
  writeProjectFile(
    siteRoot,
    'site-settings/invalid.sitesetting.yml',
    'id: not-a-uuid\nname: Webapi/cr123_item/enabled\nvalue: true\n'
  );
  writeProjectFile(
    siteRoot,
    'table-permissions/invalid.tablepermission.yml',
    'id: not-a-uuid\n'
  );
  writeProjectFile(
    siteRoot,
    'web-roles/invalid.webrole.yml',
    'id: not-a-uuid\nname: Invalid\nanonymoususersrole: false\nauthenticatedusersrole: true\n'
  );

  assert.ok(validateSiteSettings(siteRoot).summary.error > 0);
  assert.ok(validateTablePermissions(siteRoot).summary.error > 0);
  assert.ok(validateWebRoles(siteRoot).summary.error > 0);
});

test('traditional integration validator accepts token-protected Web API calls', (t) => {
  const siteRoot = createTempDeclarativeSite(t);
  writeProjectFile(
    siteRoot,
    'web-files/items/items.js',
    [
      'function loadItems() {',
      '  return shell.getTokenDeferred().then(function (token) {',
      '    return fetch("/_api/cr123_items?$select=cr123_name", {',
      '      headers: { __RequestVerificationToken: token }',
      '    });',
      '  });',
      '}',
      '',
    ].join('\n')
  );

  const result = runNode(
    path.join(
      pluginRoot,
      'skills',
      'integrate-webapi',
      'scripts',
      'validate-webapi-integration.js'
    ),
    [],
    {
      input: JSON.stringify({ cwd: siteRoot }),
    }
  );

  assert.equal(result.status, 0, result.stderr);
});

test('traditional integration validator blocks Web API calls without anti-forgery handling', (t) => {
  const siteRoot = createTempDeclarativeSite(t);
  writeProjectFile(
    siteRoot,
    'web-files/items/items.js',
    'fetch("/_api/cr123_items?$select=cr123_name");\n'
  );

  const result = runNode(
    path.join(
      pluginRoot,
      'skills',
      'integrate-webapi',
      'scripts',
      'validate-webapi-integration.js'
    ),
    [],
    {
      input: JSON.stringify({ cwd: siteRoot }),
    }
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing a supported anti-forgery token pattern/);
});
