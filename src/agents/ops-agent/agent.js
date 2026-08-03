/**
 * Ops Agent - Operations & Research Agent
 * Has MCP tool access, can use browser, research, system ops
 * Coordinates with File Agent via containment folder
 */

import ollama from 'ollama';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../config/index.js';
import { MCPClientManager } from './mcp-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OPS_AGENT_SYSTEM_PROMPT = `You are the Ops Agent - the operational intelligence of the Guardian system.

ROLE:
- Execute system operations and browser automation
- Research and gather information for the File Agent
- Interface with external tools via MCP
- Monitor for anomalies and coordinate responses
- Process user requests from the command interface

CAPABILITIES:
- mcp_tool: Execute MCP server tools
- browser_control: Control browser for automation
- research: Search and gather information
- system_info: Get system status
- coordinate: Send tasks to File Agent via containment folder
- alert: Notify user of important events

YOU WORK IN TANDEM WITH FILE AGENT:
- You handle external operations, it handles file internals
- Share findings via the containment folder
- It cannot access network - you fetch updates for it
- You are its eyes to the outside world

BEHAVIOR:
- Proactive monitoring - don't wait to be asked
- Clear communication with user
- Escalate uncertain situations
- Maintain step limits to avoid confusion`;

class OpsAgent {
  constructor(patternStore = null) {
    this.model = config.ollama.opsAgentModel;
    this.stepCount = 0;
    this.mcpManager = new MCPClientManager();
    this.patternStore = patternStore;
  }

  async initialize(mcpServers = ['system']) {
    try {
      const models = await ollama.list();
      const hasModel = models.models.some(m => m.name.includes(this.model));
      if (!hasModel) {
        console.log(`Pulling model ${this.model}...`);
        await ollama.pull({ model: this.model });
      }

      // Initialize MCP connections
      await this.mcpManager.initialize(mcpServers);

      console.log(`Ops Agent initialized with ${this.model} (${this.mcpManager.clients.size} MCP servers)`);
    } catch (err) {
      console.error('Failed to initialize Ops Agent:', err.message);
    }
  }

  async processRequest(request, context = {}) {
    this.stepCount = 0;

    const systemContext = `${OPS_AGENT_SYSTEM_PROMPT}

CURRENT CONTEXT:
${JSON.stringify(context, null, 2)}`;

    const response = await ollama.chat({
      model: this.model,
      messages: [
        { role: 'system', content: systemContext },
        { role: 'user', content: request }
      ]
    });

    return this.parseResponse(response.message.content);
  }

  parseResponse(response) {
    return {
      content: response,
      action: this.extractAction(response),
      toFileAgent: this.extractFileAgentTask(response),
      alertLevel: this.extractAlertLevel(response)
    };
  }

  extractAction(response) {
    const match = response.match(/\[OPS_ACTION:\s*(\w+)(?::\s*([^\]]+))?\]/);
    if (match) {
      return {
        type: match[1].toLowerCase(),
        params: match[2] ? match[2].trim() : null
      };
    }
    return null;
  }

  extractFileAgentTask(response) {
    const match = response.match(/\[TO_FILE_AGENT:\s*([^\]]+)\]/);
    return match ? match[1].trim() : null;
  }

  extractAlertLevel(response) {
    const match = response.match(/\[ALERT:\s*(\w+)\]/);
    return match ? match[1].toLowerCase() : 'info';
  }

  async sendToFileAgent(task) {
    const taskFile = path.join(config.containmentFolder, 'pending', `task-${Date.now()}.json`);
    await fs.writeFile(taskFile, JSON.stringify({
      from: 'ops-agent',
      task,
      timestamp: new Date().toISOString()
    }, null, 2));
    return taskFile;
  }

  async readFromFileAgent() {
    const approvedPath = path.join(config.containmentFolder, 'approved');
    const results = [];

    try {
      const files = await fs.readdir(approvedPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(approvedPath, file), 'utf-8');
          results.push(JSON.parse(content));
        }
      }
    } catch {
      // Folder may not exist yet
    }

    return results;
  }

  async getSystemInfo() {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      memory: process.memoryUsage(),
      uptime: process.uptime()
    };
  }

  // MCP Tool execution
  async executeMCPTool(toolName, args) {
    return this.mcpManager.execute(toolName, args);
  }

  listMCPTools() {
    return this.mcpManager.listTools();
  }

  getMCPAuditLog(limit = 50) {
    return this.mcpManager.getAuditLog(limit);
  }

  // Browser convenience methods
  async browseTo(url) {
    return this.mcpManager.browseTo(url);
  }

  async browseClick(selector) {
    return this.mcpManager.browseClick(selector);
  }

  async browseScreenshot() {
    return this.mcpManager.browseScreenshot();
  }

  async closeMCP() {
    await this.mcpManager.close();
  }

  incrementStep() {
    this.stepCount++;
    return this.stepCount >= config.agents.maxStepsPerTask;
  }

  reset() {
    this.stepCount = 0;
  }
}

export { OpsAgent, OPS_AGENT_SYSTEM_PROMPT };
