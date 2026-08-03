#!/usr/bin/env node
/**
 * Sandboxed File System MCP Server
 * File operations restricted to a specific sandbox directory
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';

const SANDBOX_DIR = process.argv[2] || path.join(process.cwd(), 'containment');

const server = new McpServer({
  name: 'guardian-sandboxed-fs',
  version: '1.0.0'
});

function isSandboxedPath(filePath) {
  const absolute = path.resolve(filePath);
  const sandbox = path.resolve(SANDBOX_DIR);
  return absolute.startsWith(sandbox);
}

server.tool('read_file', 'Read a file within the sandbox', {
  path: z.string().describe('File path within sandbox')
}, async (args) => {
  if (!isSandboxedPath(args.path)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Path outside sandbox' }) }], isError: true };
  }
  try {
    const content = await fs.readFile(args.path, 'utf-8');
    return { content: [{ type: 'text', text: JSON.stringify({ content, path: args.path }, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
  }
});

server.tool('write_file', 'Write a file within the sandbox', {
  path: z.string().describe('File path within sandbox'),
  content: z.string().describe('File content')
}, async (args) => {
  if (!isSandboxedPath(args.path)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Path outside sandbox' }) }], isError: true };
  }
  try {
    await fs.writeFile(args.path, args.content, 'utf-8');
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, path: args.path }, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
  }
});

server.tool('list_directory', 'List contents of a directory', {
  path: z.string().optional().describe('Directory path (default: sandbox root)')
}, async (args) => {
  const listPath = args?.path || SANDBOX_DIR;
  if (!isSandboxedPath(listPath)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Path outside sandbox' }) }], isError: true };
  }
  try {
    const entries = await fs.readdir(listPath, { withFileTypes: true });
    const items = entries.map(e => ({ name: e.name, isDir: e.isDirectory() }));
    return { content: [{ type: 'text', text: JSON.stringify({ items, path: listPath }, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
  }
});

server.tool('create_directory', 'Create a directory', {
  path: z.string().describe('Directory path to create')
}, async (args) => {
  if (!isSandboxedPath(args.path)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Path outside sandbox' }) }], isError: true };
  }
  try {
    await fs.mkdir(args.path, { recursive: true });
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, path: args.path }, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
  }
});

server.tool('delete_file', 'Delete a file (requires confirmation)', {
  path: z.string().describe('File to delete'),
  confirm: z.boolean().describe('Must be true to confirm deletion')
}, async (args) => {
  if (!args.confirm) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Deletion requires confirm: true' }) }], isError: true };
  }
  if (!isSandboxedPath(args.path)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Path outside sandbox' }) }], isError: true };
  }
  try {
    await fs.unlink(args.path);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deleted: args.path }, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
  }
});

server.tool('move_file', 'Move/rename a file', {
  source: z.string().describe('Source path'),
  destination: z.string().describe('Destination path')
}, async (args) => {
  if (!isSandboxedPath(args.source) || !isSandboxedPath(args.destination)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Source or destination outside sandbox' }) }], isError: true };
  }
  try {
    await fs.rename(args.source, args.destination);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, from: args.source, to: args.destination }, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
  }
});

server.tool('get_sandbox_path', 'Get the sandbox root directory', {}, async () => {
  return { content: [{ type: 'text', text: JSON.stringify({ sandboxPath: path.resolve(SANDBOX_DIR) }, null, 2) }] };
});

// Start server
const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
