#!/usr/bin/env node
/**
 * Safe Fetch MCP Server
 * HTTP fetch with domain whitelisting - controlled network access
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Whitelisted domains (only these can be fetched)
const ALLOWED_DOMAINS = new Set([
  'github.com', 'api.github.com', 'raw.githubusercontent.com',
  'registry.npmjs.org', 'api.npmjs.org',
  'pypi.org', 'files.pythonhosted.org',
  'crates.io', 'static.crates.io',
  'rubygems.org', 'api.rubygems.org'
]);

const server = new McpServer({
  name: 'guardian-safe-fetch',
  version: '1.0.0'
});

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    return '';
  }
}

server.tool('fetch', 'Fetch content from a whitelisted URL', {
  url: z.string().describe('URL to fetch'),
  method: z.enum(['GET', 'HEAD']).optional().default('GET').describe('HTTP method'),
  headers: z.record(z.string()).optional().describe('Optional headers')
}, async (args) => {
  const url = args.url;
  const fetchDomain = extractDomain(url);

  if (!ALLOWED_DOMAINS.has(fetchDomain)) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Domain not allowed',
          domain: fetchDomain,
          allowed: false,
          allowedDomains: Array.from(ALLOWED_DOMAINS)
        }, null, 2)
      }],
      isError: true
    };
  }

  try {
    const response = await fetch(url, {
      method: args.method || 'GET',
      headers: args.headers || { 'User-Agent': 'Guardian-Agent/1.0' }
    });

    const contentType = response.headers.get('content-type') || '';
    let body;
    if (contentType.includes('json')) {
      body = await response.json();
    } else if (contentType.includes('text')) {
      body = await response.text();
      if (body.length > 50000) {
        body = body.substring(0, 50000) + '\n... [truncated]';
      }
    } else {
      body = `[Binary content: ${contentType}]`;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          url,
          status: response.status,
          statusText: response.statusText,
          body
        }, null, 2)
      }]
    };
  } catch (err) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
  }
});

server.tool('list_allowed_domains', 'List all whitelisted domains', {}, async () => {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        domains: Array.from(ALLOWED_DOMAINS),
        total: ALLOWED_DOMAINS.size
      }, null, 2)
    }]
  };
});

server.tool('check_url', 'Check if a URL is from an allowed domain', {
  url: z.string().describe('URL to check')
}, async (args) => {
  const domain = extractDomain(args.url);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        url: args.url,
        domain,
        allowed: ALLOWED_DOMAINS.has(domain)
      }, null, 2)
    }]
  };
});

// Start server
const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
