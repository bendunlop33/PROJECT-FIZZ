// Metro config for the npm-workspaces monorepo (https://docs.expo.dev/guides/monorepos/).
// expo/metro-config (SDK 52+) detects workspaces itself; the lines below make the
// monorepo settings explicit and keep agent worktrees out of the module graph.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole repo so edits to packages/* (TypeScript source, no build step) reload.
if (!config.watchFolders.includes(workspaceRoot)) {
  config.watchFolders = [...config.watchFolders, workspaceRoot];
}

// npm hoists most dependencies to the root node_modules; look there after the app's own.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// .claude/worktrees holds other agents' full checkouts (with their own packages/*
// and node_modules). Without this, Metro sees duplicate package names.
const escapeRegExp = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blockWorktrees = new RegExp(`^${escapeRegExp(path.join(workspaceRoot, '.claude'))}(/.*)?$`);
const existing = config.resolver.blockList;
config.resolver.blockList = Array.isArray(existing)
  ? [...existing, blockWorktrees]
  : existing
    ? [existing, blockWorktrees]
    : [blockWorktrees];

module.exports = config;
