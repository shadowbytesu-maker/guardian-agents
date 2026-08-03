#!/usr/bin/env node
/**
 * System Info MCP Server
 * Read-only system information - safe, no network access
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import os from 'os';
import { execSync } from 'child_process';

const server = new McpServer({
  name: 'guardian-system-info',
  version: '1.0.0'
});

// Safe environment variables (whitelist)
const SAFE_ENV_VARS = new Set([
  'NODE_VERSION', 'PATH', 'HOME', 'USER', 'SHELL', 'PWD',
  'LANG', 'TERM', 'EDITOR', 'VISUAL', 'TMPDIR', 'TEMP',
  'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS'
]);

// Helper functions
function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${mins}m`;
}

// Tool definitions with Zod schemas
server.tool('get_system_info', 'Get basic system information', {}, async () => {
  const result = {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'unknown',
    totalMemory: formatBytes(os.totalmem()),
    freeMemory: formatBytes(os.freemem()),
    uptime: formatUptime(os.uptime()),
    nodeVersion: process.version
  };
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

server.tool('get_disk_usage', 'Get disk space information', {
  path: z.string().optional().describe('Path to check')
}, async (args) => {
  const checkPath = args?.path || '/';
  try {
    const output = execSync(`df -h "${checkPath}" 2>/dev/null || dir "${checkPath}"`, {
      encoding: 'utf-8',
      timeout: 5000
    });
    return { content: [{ type: 'text', text: JSON.stringify({ path: checkPath, output: output.trim() }, null, 2) }] };
  } catch {
    return { content: [{ type: 'text', text: JSON.stringify({ path: checkPath, output: 'Unable to get disk info' }, null, 2) }] };
  }
});

server.tool('get_process_list', 'Get list of running processes', {}, async () => {
  try {
    const output = execSync(
      process.platform === 'win32'
        ? 'tasklist /FO CSV /NH 2>nul'
        : 'ps aux --sort=-%cpu 2>/dev/null | head -21',
      { encoding: 'utf-8', timeout: 5000 }
    );
    return { content: [{ type: 'text', text: JSON.stringify({ processes: output.trim() }, null, 2) }] };
  } catch {
    return { content: [{ type: 'text', text: JSON.stringify({ processes: 'Unable to list processes' }, null, 2) }] };
  }
});

server.tool('get_network_interfaces', 'Get network interface information', {}, async () => {
  const interfaces = os.networkInterfaces();
  const safeInterfaces = {};
  for (const [name, addrs] of Object.entries(interfaces)) {
    safeInterfaces[name] = addrs.map(addr => ({
      family: addr.family,
      address: addr.address,
      internal: addr.internal
    }));
  }
  return { content: [{ type: 'text', text: JSON.stringify({ interfaces: safeInterfaces }, null, 2) }] };
});

server.tool('get_env_var', 'Get a specific environment variable', {
  name: z.string().describe('Environment variable name')
}, async (args) => {
  const varName = args.name.toUpperCase();
  if (!SAFE_ENV_VARS.has(varName)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: `Environment variable '${varName}' not in safe list` }, null, 2) }] };
  }
  return { content: [{ type: 'text', text: JSON.stringify({ name: varName, value: process.env[varName] || 'not set' }, null, 2) }] };
});

// Start server
const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
