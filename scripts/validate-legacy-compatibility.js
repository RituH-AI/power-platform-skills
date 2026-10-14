#!/usr/bin/env node

/**
 * Validates the Agent Plugins manifests and their legacy compatibility mirrors.
 * Existing marketplace subscriptions still resolve .plugin and .claude-plugin
 * paths during auto-update, so those committed files must stay semantically in
 * sync with the portable root manifest whenever plugin metadata changes.
 *
 * The one intentional difference is the `source` of a plugin hosted in another
 * repository, which each host spells differently. See REMOTE PLUGIN SOURCES below.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const ROOT = path.resolve(__dirname, '..');
const AGENT_PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const AGENT_MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const AGENT_PLUGIN_FIELDS = [
  '$schema',
  'author',
  'description',
  'extensions',
  'homepage',
  'keywords',
  'license',
  'name',
  'repository',
  'version',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRelative(relativePath) {
  return relativePath.replace(/\\/g, '/').replace(/\/+$/, '');
}

function pluginDirectoryFromOpenEntry(root, openMarketplace, plugin) {
  const pluginRoot = openMarketplace.metadata?.pluginRoot || '.';
  return path.resolve(root, pluginRoot, plugin.source);
}

function expectedLegacySource(root, pluginDirectory) {
  return `./${normalizeRelative(path.relative(root, pluginDirectory))}`;
}

function assertJsonMirror(legacyPath, sourcePath) {
  assert.deepEqual(readJson(legacyPath), readJson(sourcePath));
}

function portableMetadata(manifest) {
  const { $schema, ...metadata } = manifest;
  return metadata;
}

function expectedPortableMcp(legacyMcp, pluginName) {
  const servers = Object.fromEntries(
    Object.entries(legacyMcp.mcpServers || {}).map(([name, server]) => {
      const type = server.type === 'http'
        ? 'streamable-http'
        : server.type || (server.url ? 'streamable-http' : 'stdio');
      const { type: ignoredType, ...configuration } = server;
      const portableName = name === pluginName || name.startsWith(`${pluginName}-`)
        ? name
        : `${pluginName}-${name}`;
      return [portableName, { type, ...configuration }];
    })
  );
  return { $schema: AGENT_MCP_SCHEMA, mcpServers: servers };
}

// ── REMOTE PLUGIN SOURCES ─────────────────────────────────────
// A plugin maintained in another repository is listed with an object `source`
// instead of a `./plugins/<name>` path. When the plugin sits in a subdirectory of
// that repository, Copilot CLI and Claude Code need different spellings, and each
// host reads a different file of ours:
//
//   marketplace.json (Copilot CLI reads this one first):
//     { "source": "github", "repo": "owner/repo", "path": "sub/dir" }
//   .claude-plugin/marketplace.json (Claude Code reads only this one):
//     { "source": "git-subdir", "url": "owner/repo", "path": "sub/dir" }
//
// Neither spelling works on the other host, so the two files must differ here:
//   - Copilot CLI rejects `git-subdir` with "plugins.N.source: Invalid input" and then
//     refuses to add the whole marketplace, which would break every plugin we ship.
//   - Claude Code's `github` source has no `path` field. It ignores `path`, installs
//     the repository root, and reports success while loading none of the plugin's skills.
// Verified with Claude Code 2.1.285 and Copilot CLI 1.0.90. Docs:
//   https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference#plugin-source-types
//   https://code.claude.com/docs/en/plugins/marketplace-reference#plugin-sources
const REMOTE_SOURCE_KEYS = ['path', 'ref', 'repo', 'sha', 'source'];
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

function isRemoteSource(source) {
  return source !== null && typeof source === 'object' && !Array.isArray(source);
}

function assertRemoteOpenSource(source) {
  assert.equal(
    source.source,
    'github',
    'a remote source in marketplace.json must use the "github" type; Copilot CLI rejects other types such as "git-subdir" and then refuses the whole marketplace'
  );
  for (const key of Object.keys(source)) {
    assert.ok(REMOTE_SOURCE_KEYS.includes(key), `unsupported remote source key "${key}"`);
  }
  assert.match(String(source.repo), GITHUB_REPO_PATTERN, 'repo must be in owner/repo form');
  if ('path' in source) {
    assert.equal(typeof source.path, 'string', 'path must be a string');
    const segments = source.path.split('/');
    assert.ok(
      source.path !== '' && !source.path.startsWith('/') && !source.path.includes('\\') && !segments.includes('..'),
      'path must be a forward-slash path relative to the repository root, without ".."'
    );
  }
  if ('ref' in source) {
    assert.equal(typeof source.ref, 'string', 'ref must be a string');
    assert.notEqual(source.ref.trim(), '', 'ref must not be empty');
  }
  if ('sha' in source) {
    assert.match(String(source.sha), COMMIT_SHA_PATTERN, 'sha must be a full 40-character lowercase commit SHA');
  }
}

function expectedLegacyRemoteSource(openSource) {
  const { source, repo, path: subdirectory, ...pin } = openSource;
  // Without a `path`, both hosts read `github` the same way, so the entry mirrors as is.
  if (subdirectory === undefined) return openSource;
  return { source: 'git-subdir', url: repo, path: subdirectory, ...pin };
}

function assertMinimalMarketplaceEntry(plugin) {
  // Marketplace entries only require `name` and `source`. Optional
  // fields like description/version/license/keywords are override fields, so keep
  // the marketplace as an index and let each plugin's root `plugin.json` remain
  // the single source of truth for display and update metadata.
  // See: https://open-plugins.com/plugin-builders/marketplace
  assert.deepEqual(Object.keys(plugin).sort(), ['name', 'source']);
  assert.equal(typeof plugin.name, 'string', 'name must be a string');
  assert.notEqual(plugin.name.trim(), '', 'name must not be empty');
  if (isRemoteSource(plugin.source)) return;
  assert.equal(typeof plugin.source, 'string', 'source must be a string or a remote source object');
  assert.match(plugin.source, /^\.\//, 'source must start with ./');
}

function assertMinimalMarketplace(marketplace) {
  // Keep marketplace-level metadata here because it describes the collection, not
  // any individual plugin. Per-plugin optional fields still stay out of `plugins`
  // entries to avoid overriding the corresponding root `plugin.json` metadata.
  assert.deepEqual(Object.keys(marketplace).sort(), ['metadata', 'name', 'owner', 'plugins']);
  assert.equal(typeof marketplace.name, 'string', 'name must be a string');
  assert.notEqual(marketplace.name.trim(), '', 'name must not be empty');
  assert.equal(typeof marketplace.owner?.name, 'string', 'owner.name must be a string');
  assert.notEqual(marketplace.owner.name.trim(), '', 'owner.name must not be empty');
  assert.equal(typeof marketplace.metadata?.description, 'string', 'metadata.description must be a string');
  assert.notEqual(marketplace.metadata.description.trim(), '', 'metadata.description must not be empty');
  assert.equal(typeof marketplace.metadata?.pluginRoot, 'string', 'metadata.pluginRoot must be a string');
  assert.match(marketplace.metadata.pluginRoot, /^\./, 'metadata.pluginRoot must be relative');
  assert.ok(Array.isArray(marketplace.plugins), 'plugins must be an array');
  assert.ok(marketplace.plugins.length > 0, 'plugins must contain at least one entry');
}

function assertPluginMetadata(pluginName, manifest) {
  // Marketplace plugin entries intentionally omit these optional override fields.
  // Keep them in each plugin manifest instead so `plugin.json` remains the single
  // source of truth for display/update metadata.
  assert.equal(manifest.name, pluginName);
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'version must be semantic');
  assert.equal(typeof manifest.description, 'string', 'description must be a string');
  assert.notEqual(manifest.description.trim(), '', 'description must not be empty');
  assert.equal(typeof manifest.author?.name, 'string', 'author.name must be a string');
  assert.notEqual(manifest.author.name.trim(), '', 'author.name must not be empty');
  assert.equal(typeof manifest.homepage, 'string', 'homepage must be a string');
  assert.notEqual(manifest.homepage.trim(), '', 'homepage must not be empty');
  assert.equal(typeof manifest.repository, 'string', 'repository must be a string');
  assert.notEqual(manifest.repository.trim(), '', 'repository must not be empty');
  assert.equal(typeof manifest.license, 'string', 'license must be a string');
  assert.notEqual(manifest.license.trim(), '', 'license must not be empty');
  assert.ok(Array.isArray(manifest.keywords), 'keywords must be an array');
  assert.ok(manifest.keywords.length > 0, 'keywords must contain at least one entry');
  for (const [index, keyword] of manifest.keywords.entries()) {
    assert.equal(typeof keyword, 'string', `keywords[${index}] must be a string`);
    assert.notEqual(keyword.trim(), '', `keywords[${index}] must not be empty`);
  }
}

function assertPortableManifest(pluginName, manifest) {
  assert.equal(manifest.$schema, AGENT_PLUGIN_SCHEMA, 'unsupported or missing Agent Plugins schema');
  for (const field of Object.keys(manifest)) {
    assert.ok(AGENT_PLUGIN_FIELDS.includes(field), `unsupported Agent Plugins field "${field}"`);
  }
  assertPluginMetadata(pluginName, manifest);
}

function validate(root = ROOT) {
  const openMarketplacePath = path.join(root, 'marketplace.json');
  const legacyMarketplacePath = path.join(root, '.claude-plugin', 'marketplace.json');
  const errors = [];

  function check(label, fn) {
    try {
      fn();
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  }

  check('legacy marketplace manifest', () => {
    assert.ok(fs.existsSync(legacyMarketplacePath), 'missing .claude-plugin/marketplace.json');
  });
  if (errors.length > 0) return errors;

  const openMarketplace = readJson(openMarketplacePath);
  const legacyMarketplace = readJson(legacyMarketplacePath);

  check('marketplace shape', () => {
    assertMinimalMarketplace(openMarketplace);
    assertMinimalMarketplace(legacyMarketplace);
  });
  if (errors.length > 0) return errors;

  // Everything except remote plugin sources must be a byte-for-byte semantic mirror,
  // so compare the files with those sources swapped for their expected legacy form.
  check('legacy marketplace manifest', () => {
    const expectedLegacy = {
      ...openMarketplace,
      plugins: openMarketplace.plugins.map((plugin) =>
        isRemoteSource(plugin.source) ? { ...plugin, source: expectedLegacyRemoteSource(plugin.source) } : plugin
      ),
    };
    assert.deepEqual(legacyMarketplace, expectedLegacy);
  });

  const legacyPlugins = new Map(legacyMarketplace.plugins.map((plugin) => [plugin.name, plugin]));
  const openPluginNames = new Set();

  for (const plugin of openMarketplace.plugins) {
    openPluginNames.add(plugin.name);

    if (isRemoteSource(plugin.source)) {
      // The plugin's manifests live in its own repository, which owns their metadata
      // and legacy mirrors; CI here deliberately does not fetch them over the network.
      check(`${plugin.name} remote marketplace entry`, () => {
        assertMinimalMarketplaceEntry(plugin);
        assertRemoteOpenSource(plugin.source);
        const legacyPlugin = legacyPlugins.get(plugin.name);
        assert.ok(legacyPlugin, 'missing from .claude-plugin/marketplace.json');
        assertMinimalMarketplaceEntry(legacyPlugin);
        assert.deepEqual(legacyPlugin.source, expectedLegacyRemoteSource(plugin.source));
      });
      continue;
    }

    const pluginDirectory = pluginDirectoryFromOpenEntry(root, openMarketplace, plugin);
    const portableManifestPath = path.join(pluginDirectory, 'plugin.json');
    const openManifestPath = path.join(pluginDirectory, '.plugin', 'plugin.json');
    const legacyManifestPath = path.join(pluginDirectory, '.claude-plugin', 'plugin.json');
    const portableMcpPath = path.join(pluginDirectory, 'mcp.json');
    const legacyMcpPath = path.join(pluginDirectory, '.mcp.json');
    const relativeLegacyManifestPath = normalizeRelative(path.relative(root, legacyManifestPath));

    check(`${plugin.name} legacy marketplace entry`, () => {
      const legacyPlugin = legacyPlugins.get(plugin.name);
      assert.ok(legacyPlugin, 'missing from .claude-plugin/marketplace.json');
      assert.equal(legacyPlugin.source, expectedLegacySource(root, pluginDirectory));
      assertMinimalMarketplaceEntry(plugin);
      assertMinimalMarketplaceEntry(legacyPlugin);
    });

    check(`${plugin.name} Agent Plugins manifest`, () => {
      assert.ok(fs.existsSync(portableManifestPath), 'missing root plugin.json');
      const portableManifest = readJson(portableManifestPath);
      assertPortableManifest(plugin.name, portableManifest);
      assert.deepEqual(readJson(openManifestPath), portableMetadata(portableManifest));
    });

    check(relativeLegacyManifestPath, () => {
      assert.ok(fs.existsSync(legacyManifestPath), 'missing legacy plugin manifest');
      assertJsonMirror(legacyManifestPath, openManifestPath);
    });

    check(`${plugin.name} MCP configuration`, () => {
      if (!fs.existsSync(legacyMcpPath)) {
        assert.ok(!fs.existsSync(portableMcpPath), 'root mcp.json has no legacy .mcp.json counterpart');
        return;
      }
      assert.ok(fs.existsSync(portableMcpPath), 'missing root mcp.json');
      assert.deepEqual(readJson(portableMcpPath), expectedPortableMcp(readJson(legacyMcpPath), plugin.name));
    });
  }

  for (const legacyPluginName of legacyPlugins.keys()) {
    check(`${legacyPluginName} legacy marketplace entry`, () => {
      assert.ok(openPluginNames.has(legacyPluginName), 'not present in marketplace.json');
    });
  }

  return errors;
}

if (require.main === module) {
  const errors = validate();
  if (errors.length > 0) {
    console.log('Found Agent Plugins or legacy compatibility issues:');
    for (const error of errors) {
      console.log(`- ${error}`);
    }
    process.exit(1);
  }
  console.log('Agent Plugins manifests and legacy compatibility files are in sync.');
}

module.exports = {
  validate,
  expectedLegacyRemoteSource,
  expectedPortableMcp,
  assertRemoteOpenSource,
};
