/**
 * MCP Client Manager - Model Context Protocol Connection
 * Manages connections to MCP servers for controlled external access
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { config } from '../../config/index.js';

// MCP Server configurations - all controlled, audited gateways
const MCP_SERVERS = {
  // Browser automation server (puppeteer/playwright based)
  browser: {
    command: 'npx',
    args: ['-y', '@anthropic-ai/mcp-server-puppeteer'],
    description: 'Browser automation - controlled web navigation',
    allowedDomains: null, // null = all allowed, or array for whitelist
  },

  // Safe fetch server with domain whitelisting
  'safe-fetch': {
    command: 'node',
    args: ['./mcp-servers/safe-fetch/index.js'],
    description: 'HTTP fetch with domain whitelist',
    allowedDomains: ['github.com', 'api.github.com', 'registry.npmjs.org'],
  },

  // System information (read-only)
  system: {
    command: 'node',
    args: ['./mcp-servers/system-info/index.js'],
    description: 'System status and metrics (read-only)',
    readOnly: true,
  },

  // File system with sandbox restrictions
  sandboxedFs: {
    command: 'node',
    args: ['./mcp-servers/sandboxed-fs/index.js', config.containmentFolder],
    description: 'File operations within containment only',
    sandboxed: true,
  }
};

class MCPClientManager {
  constructor() {
    this.clients = new Map(); // serverName -> { client, transport, tools }
    this.toolIndex = new Map(); // toolName -> serverName
    this.auditLog = [];
    this.connected = false;
  }

  async initialize(servers = ['browser', 'system']) {
    for (const serverName of servers) {
      try {
        await this.connectServer(serverName);
      } catch (err) {
        console.error(`Failed to connect MCP server ${serverName}:`, err.message);
        console.log(`Tip: Ensure MCP server is installed or update configuration`);
      }
    }
    this.connected = true;
    console.log(`MCP Manager initialized with ${this.clients.size} servers`);
  }

  async connectServer(serverName) {
    const serverConfig = MCP_SERVERS[serverName];
    if (!serverConfig) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args,
    });

    const client = new Client(
      { name: 'guardian-ops', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    await client.connect(transport);

    // Get available tools
    const toolsResult = await client.listTools();
    const tools = toolsResult.tools || [];

    // Index tools
    tools.forEach(tool => {
      this.toolIndex.set(tool.name, { serverName, tool });
    });

    // Store connection
    this.clients.set(serverName, {
      client,
      transport,
      tools,
      config: serverConfig,
    });

    console.log(`Connected to MCP server: ${serverName} (${tools.length} tools)`);
    tools.forEach(t => console.log(`  - ${t.name}: ${t.description?.slice(0, 50)}...`));
  }

  // Check if a tool is available
  hasTool(toolName) {
    return this.toolIndex.has(toolName);
  }

  // List all available tools
  listTools() {
    const tools = [];
    this.clients.forEach(({ tools: serverTools }, serverName) => {
      serverTools.forEach(tool => {
        tools.push({
          name: tool.name,
          server: serverName,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      });
    });
    return tools;
  }

  // Execute an MCP tool call
  async execute(toolName, args) {
    const toolInfo = this.toolIndex.get(toolName);
    if (!toolInfo) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const { serverName } = toolInfo;
    const { client, config: serverConfig } = this.clients.get(serverName);

    // Audit the call
    const auditEntry = {
      timestamp: new Date().toISOString(),
      tool: toolName,
      server: serverName,
      args,
    };
    this.auditLog.push(auditEntry);

    // Domain whitelisting for network tools
    if (serverConfig.allowedDomains && args.url) {
      const url = new URL(args.url);
      if (!serverConfig.allowedDomains.includes(url.hostname)) {
        throw new Error(`Domain not allowed: ${url.hostname}. Allowed: ${serverConfig.allowedDomains.join(', ')}`);
      }
    }

    try {
      const result = await client.callTool({
        name: toolName,
        arguments: args,
      });

      // Update audit with result
      auditEntry.success = true;
      auditEntry.resultType = result.content?.[0]?.type || 'unknown';

      return result;
    } catch (err) {
      auditEntry.success = false;
      auditEntry.error = err.message;
      throw err;
    }
  }

  // Browser-specific helper
  async browseTo(url) {
    return this.execute('puppeteer_navigate', { url });
  }

  async browseClick(selector) {
    return this.execute('puppeteer_click', { selector });
  }

  async browseScreenshot() {
    return this.execute('puppeteer_screenshot', {});
  }

  async browseEvaluate(script) {
    return this.execute('puppeteer_evaluate', { script });
  }

  // Safe fetch with domain check
  async safeFetch(url) {
    return this.execute('fetch', { url });
  }

  // Get audit log
  getAuditLog(limit = 100) {
    return this.auditLog.slice(-limit);
  }

  // Get server status
  getStatus() {
    const status = {};
    this.clients.forEach((_, serverName) => {
      status[serverName] = 'connected';
    });
    return status;
  }

  // Cleanup
  async close() {
    for (const [serverName, { client }] of this.clients) {
      try {
        await client.close();
        console.log(`Disconnected from MCP server: ${serverName}`);
      } catch (err) {
        console.error(`Error closing ${serverName}:`, err.message);
      }
    }
    this.clients.clear();
    this.toolIndex.clear();
  }
}

export { MCPClientManager, MCP_SERVERS };
