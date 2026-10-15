#!/usr/bin/env node

// Resolves the non-secret environment context required by non-SPA site creation.
// Tokens remain inside this process and are never included in stdout.

const {
  getEnvironmentUrl,
  getPacAuthInfo,
  getAuthToken,
  makeRequest,
  validateDataverseEnvironmentUrl,
  UUID_REGEX,
} = require('../../../scripts/lib/validation-helpers');

async function resolveNonSpaContext(dependencies = {}) {
  const readEnvironmentUrl = dependencies.getEnvironmentUrl || getEnvironmentUrl;
  const readPacAuthInfo = dependencies.getPacAuthInfo || getPacAuthInfo;
  const acquireToken = dependencies.getAuthToken || getAuthToken;
  const request = dependencies.makeRequest || makeRequest;

  const rawEnvironmentUrl = readEnvironmentUrl();
  const pac = readPacAuthInfo();
  if (!rawEnvironmentUrl || !pac || !pac.environmentId) {
    throw new Error(
      'Power Platform CLI is not signed in to a Dataverse environment. Run "pac auth create" and retry.',
    );
  }

  const environmentUrl = validateDataverseEnvironmentUrl(rawEnvironmentUrl);
  const token = acquireToken(environmentUrl);
  if (!token) {
    throw new Error('Azure CLI token is unavailable. Run "az login" and retry.');
  }

  const result = await request({
    url: `${environmentUrl}/api/data/v9.2/WhoAmI`,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    timeout: 15_000,
  });

  if (result.error) {
    throw new Error(`Dataverse WhoAmI request failed: ${result.error}`);
  }
  if (result.statusCode !== 200) {
    throw new Error(`Dataverse WhoAmI returned HTTP ${result.statusCode}.`);
  }

  let body;
  try {
    body = JSON.parse(result.body);
  } catch {
    throw new Error('Dataverse WhoAmI returned invalid JSON.');
  }
  if (!body.OrganizationId) {
    throw new Error('Dataverse WhoAmI did not return OrganizationId.');
  }
  if (!UUID_REGEX.test(body.OrganizationId)) {
    throw new Error('Dataverse WhoAmI returned an invalid OrganizationId.');
  }

  // The Create Website API requires selectedBaseLanguage. Use the Dataverse
  // organization's authoritative base-language LCID instead of assuming English.
  // See: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/organization
  const organizationResult = await request({
    url:
      `${environmentUrl}/api/data/v9.2/organizations(${body.OrganizationId})` +
      '?$select=languagecode',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    timeout: 15_000,
  });

  if (organizationResult.error) {
    throw new Error(
      `Dataverse organization language request failed: ${organizationResult.error}`,
    );
  }
  if (organizationResult.statusCode !== 200) {
    throw new Error(
      `Dataverse organization language request returned HTTP ${organizationResult.statusCode}.`,
    );
  }

  let organization;
  try {
    organization = JSON.parse(organizationResult.body);
  } catch {
    throw new Error('Dataverse organization language request returned invalid JSON.');
  }
  if (!Number.isInteger(organization.languagecode) || organization.languagecode <= 0) {
    throw new Error(
      'Dataverse organization language request did not return a positive integer languagecode.',
    );
  }

  return {
    environmentUrl,
    environmentId: pac.environmentId,
    organizationId: body.OrganizationId,
    organizationBaseLanguageLcid: organization.languagecode,
    cloud: pac.cloud || 'Public',
  };
}

async function main() {
  try {
    const context = await resolveNonSpaContext();
    process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { resolveNonSpaContext };
