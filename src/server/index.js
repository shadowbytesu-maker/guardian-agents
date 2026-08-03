/**
 * Guardian Agents - MCP Orchestration Server
 * Coordinates File Agent and Ops Agent
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { config } from '../config/index.js';
import { FileAgent } from '../agents/file-agent/agent.js';
import { OpsAgent } from '../agents/ops-agent/agent.js';
import { WatchFolderBridge } from '../bridge/watch-folder.js';
import { ApprovalSystem } from './approval-system.js';
import { PatternStore } from '../patterns/pattern-store.js';
import { AutoOrganizeWatcher } from '../watchers/auto-organize.js';
import { ErrorRecovery, setupGlobalErrorHandling, setupGracefulShutdown } from '../utils/error-recovery.js';
import { promises as fs } from 'fs';
import path from 'path';

// Setup global error handling
setupGlobalErrorHandling();

class GuardianOrchestrator {
  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.wss = null; // Will be initialized after server starts

    // Pattern storage (workflow memory)
    this.patternStore = new PatternStore();

    // Agents with pattern awareness
    this.fileAgent = new FileAgent(this.patternStore);
    this.opsAgent = new OpsAgent(this.patternStore);

    // Systems
    this.approvalSystem = new ApprovalSystem();
    this.watchBridge = null;
    this.autoOrganizer = null;

    this.activeTasks = new Map();
    this.clients = new Set();
  }

  async start() {
    // Initialize pattern store (workflow memory)
    await this.patternStore.initialize();

    // Initialize agents with MCP
    await this.fileAgent.initialize();
    await this.opsAgent.initialize(config.mcpServers || ['system']);

    // Initialize auto-organize watcher
    this.autoOrganizer = new AutoOrganizeWatcher(this.patternStore);

    // Setup express
    this.app.use(express.json());
    this.app.use(express.static(path.join(process.cwd(), 'src/ui/public')));

    // Setup routes
    this.setupRoutes();

    // Setup WebSocket (on same port as HTTP server)
    this.wss = new WebSocketServer({ server: this.server });
    this.setupWebSocket();

    // Setup watch folder bridge
    this.watchBridge = new WatchFolderBridge(cmd => this.handleCommand(cmd));
    await this.watchBridge.start();

    // Start server
    this.server.listen(config.server.port, () => {
      console.log(`\nGuardian Agents running at http://localhost:${config.server.port}`);
      console.log(`WebSocket at ws://localhost:${config.server.port}`);
      console.log(`\nDrop commands in: ${path.resolve(config.watchFolder)}`);
      console.log(`Pattern store: ${this.patternStore.dbPath}`);
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'healthy',
        agents: {
          file: 'initialized',
          ops: 'initialized'
        },
        stats: this.approvalSystem.getStats()
      });
    });

    // Submit command
    this.app.post('/api/command', async (req, res) => {
      try {
        const result = await this.handleCommand(req.body);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Get pending approvals
    this.app.get('/api/approvals', (req, res) => {
      res.json(this.approvalSystem.getPending());
    });

    // Approve action
    this.app.post('/api/approvals/:id/approve', (req, res) => {
      const success = this.approvalSystem.approve(req.params.id);
      res.json({ success });
    });

    // Deny action
    this.app.post('/api/approvals/:id/deny', (req, res) => {
      const success = this.approvalSystem.deny(req.params.id);
      res.json({ success });
    });

    // File operations
    this.app.post('/api/files/read', async (req, res) => {
      const result = await this.fileAgent.readFile(req.body.path);
      res.json(result);
    });

    this.app.get('/api/files/list', async (req, res) => {
      const result = await this.fileAgent.listDirectory(req.query.path || process.cwd());
      res.json(result);
    });

    // Agent status
    this.app.get('/api/agents/status', (req, res) => {
      res.json({
        fileAgent: {
          model: this.fileAgent.model,
          steps: this.fileAgent.stepCount,
          task: this.fileAgent.currentTask
        },
        opsAgent: {
          model: this.opsAgent.model,
          steps: this.opsAgent.stepCount
        }
      });
    });

    // Config
    this.app.get('/api/config', (req, res) => {
      res.json({
        maxSteps: config.agents.maxStepsPerTask,
        bulkThreshold: config.bulkThreshold,
        highRiskActions: config.highRiskActions,
        mediumRiskActions: config.mediumRiskActions
      });
    });

    // Pattern Store API
    this.app.get('/api/patterns', (req, res) => {
      res.json(this.patternStore.getPatternsContext());
    });

    this.app.get('/api/patterns/top', (req, res) => {
      const limit = parseInt(req.query.limit) || 10;
      res.json(this.patternStore.getTopPatterns(limit));
    });

    this.app.post('/api/patterns/record', (req, res) => {
      const { patternType, sourcePattern, targetPattern, fileTypes } = req.body;
      const result = this.patternStore.recordPattern(patternType, sourcePattern, targetPattern, fileTypes);
      res.json(result);
    });

    // MCP Tools API
    this.app.get('/api/mcp/tools', (req, res) => {
      res.json(this.opsAgent.listMCPTools());
    });

    this.app.get('/api/mcp/audit', (req, res) => {
      res.json(this.opsAgent.getMCPAuditLog());
    });

    this.app.post('/api/mcp/execute', async (req, res) => {
      try {
        const result = await this.opsAgent.executeMCPTool(req.body.tool, req.body.args);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Auto-organize API
    this.app.get('/api/organize/rules', (req, res) => {
      res.json(this.autoOrganizer ? this.autoOrganizer.getActiveRules() : []);
    });

    this.app.post('/api/organize/rules', async (req, res) => {
      const { watchPath, ruleType, ruleConfig } = req.body;
      const result = await this.autoOrganizer.addRule(watchPath, ruleType, ruleConfig);
      res.json({ success: result });
    });

    this.app.delete('/api/organize/rules', async (req, res) => {
      const { watchPath } = req.body;
      const result = await this.autoOrganizer.removeRule(watchPath);
      res.json({ success: result });
    });

    this.app.post('/api/organize/pause', (req, res) => {
      this.autoOrganizer?.pause();
      res.json({ paused: true });
    });

    this.app.post('/api/organize/resume', (req, res) => {
      this.autoOrganizer?.resume();
      res.json({ resumed: true });
    });
  }

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log('Client connected');

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'command') {
            const result = await this.handleCommand(msg.payload);
            ws.send(JSON.stringify({ type: 'result', payload: result }));
          } else if (msg.type === 'approval_response') {
            if (msg.approved) {
              this.approvalSystem.approve(msg.id);
            } else {
              this.approvalSystem.deny(msg.id);
            }
          }
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      // Send initial state
      ws.send(JSON.stringify({
        type: 'init',
        stats: this.approvalSystem.getStats()
      }));
    });
  }

  broadcast(data) {
    const message = JSON.stringify(data);
    this.clients.forEach(ws => {
      if (ws.readyState === 1) {
        ws.send(message);
      }
    });
  }

  async handleCommand(command) {
    console.log(`Processing: ${command.content || command.type}`);

    // Determine which agent should handle
    const isFileOperation = this.isFileCommand(command);

    if (isFileOperation) {
      return this.executeWithFileAgent(command);
    } else {
      return this.executeWithOpsAgent(command);
    }
  }

  isFileCommand(command) {
    const fileKeywords = ['file', 'folder', 'directory', 'organize', 'read', 'write',
                          'move', 'copy', 'clean', 'structure', 'scan', 'analyze'];
    const content = (command.content || command.type || '').toLowerCase();
    return fileKeywords.some(k => content.includes(k));
  }

  async executeWithFileAgent(command) {
    const action = await this.fileAgent.processRequest(command.content);

    // Check if approval needed
    const evaluation = this.approvalSystem.evaluateAction(action);

    if (evaluation.requiresApproval) {
      const request = this.approvalSystem.createApprovalRequest(action);

      // Broadcast to UI for approval
      this.broadcast({
        type: 'approval_request',
        request
      });

      // Wait for approval
      const approved = await this.approvalSystem.waitForApproval(request.id);

      if (!approved) {
        return {
          success: false,
          reason: 'Action denied or expired',
          action
        };
      }
    }

    // Execute action
    let result;
    switch (action.type) {
      case 'read_file':
        result = await this.fileAgent.readFile(action.target);
        break;
      case 'list_directory':
        result = await this.fileAgent.listDirectory(action.target);
        break;
      default:
        result = { success: true, message: action.reasoning };
    }

    return result;
  }

  async executeWithOpsAgent(command) {
    const context = {
      systemInfo: await this.opsAgent.getSystemInfo(),
      fileAgentResults: []
    };

    const response = await this.opsAgent.processRequest(
      command.content || JSON.stringify(command),
      context
    );

    // If ops agent wants to send task to file agent
    if (response.toFileAgent) {
      await this.opsAgent.sendToFileAgent(response.toFileAgent);
    }

    return response;
  }
}

// Start the orchestrator
const orchestrator = new GuardianOrchestrator();

// Setup graceful shutdown
setupGracefulShutdown([
  () => orchestrator.opsAgent?.closeMCP?.(),
  () => orchestrator.autoOrganizer?.close(),
  () => orchestrator.patternStore?.close(),
  () => new Promise(resolve => orchestrator.server.close(resolve))
]);

orchestrator.start().catch(err => {
  console.error('Failed to start Guardian Agents:', err.message);
  process.exit(1);
});

export { GuardianOrchestrator };
