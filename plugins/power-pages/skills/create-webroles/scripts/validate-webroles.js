#!/usr/bin/env node

// Validates that new web role YAML files were created for an SPA or traditional site.
// Runs as a PostToolUse(Skill) hook to verify the skill produced output.

const fs = require('fs');
const path = require('path');
const {
  approve,
  block,
  runValidation,
  findProjectRoot,
  resolvePowerPagesSiteRoot,
} = require('../../../scripts/lib/validation-helpers');
const { validateWebRoles } = require('../../../scripts/lib/web-roles-validator');

runValidation((cwd) => {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) approve(); // Not a Power Pages project

  const siteRoot = resolvePowerPagesSiteRoot(projectRoot);
  const webRolesDir = siteRoot && path.join(siteRoot, 'web-roles');
  if (!webRolesDir || !fs.existsSync(webRolesDir)) {
    approve(); // No downloaded/deployed web-role metadata — not a web roles session
  }

  const validation = validateWebRoles(projectRoot);
  const webRoleFiles = validation.webRoles;
  if (webRoleFiles && webRoleFiles.length === 0) {
    block('Web roles validation failed:\n- No web role YAML files found in the resolved web-roles directory');
  }
  const errors = validation.findings
    .filter(finding => finding.severity === 'error')
    .map(finding => finding.filePath ? `${finding.message} (${path.basename(finding.filePath)})` : finding.message);

  if (errors.length > 0) {
    block('Web roles validation failed:\n- ' + errors.join('\n- '));
  }

  approve();
});
