#!/usr/bin/env node
/**
 * Guardian Agents CLI
 * Command-line interface for file organization and system management
 */

import { PatternStore } from '../patterns/pattern-store.js';
import { FileAgent } from '../agents/file-agent/agent.js';
import { OpsAgent } from '../agents/ops-agent/agent.js';
import { AutoOrganizeWatcher } from '../watchers/auto-organize.js';
import { config } from '../config/index.js';
import { promises as fs } from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const command = args[0] || 'help';

const patternStore = new PatternStore();

async function init() {
  await patternStore.initialize();
}

// Command handlers
const commands = {
  async help() {
    console.log(`
Guardian Agents CLI - Offline File Organization

USAGE:
  guardian <command> [options]

COMMANDS:
  status              Show system status and agent info
  organize <path>     Organize files in a directory
  patterns            List learned patterns
  patterns add        Add a new pattern
  rules               List auto-organize rules
  rules add <path>    Add auto-organize rule for path
  watch <path>        Watch and auto-organize a directory
  scan <path>        Scan directory for organization suggestions
  mcp tools           List available MCP tools
  mcp call <tool>     Call an MCP tool
  test               Run diagnostic tests

EXAMPLES:
  guardian organize ~/Downloads
  guardian patterns add "*.pdf" "~/Documents/PDFs"
  guardian rules add ~/Downloads --type by_extension
  guardian scan ~/Documents --dry-run

For more info: https://github.com/your-repo/guardian-agents
`);
  },

  async status() {
    await init();
    const patterns = patternStore.getPatternsContext();
    console.log('\n=== Guardian Agents Status ===\n');
    console.log(`Platform:         ${process.platform} (${process.arch})`);
    console.log(`Node Version:     ${process.version}`);
    console.log(`Containment:      ${path.resolve(config.containmentFolder)}`);
    console.log(`Pattern Store:    ${patternStore.dbPath}`);
    console.log(`\n--- Learning ---`);
    console.log(`Patterns Learned: ${patterns.topPatterns.length}`);
    console.log(`Success Rate:     ${patterns.successRate}%`);
    console.log(`Active Rules:      ${patterns.activeRules}`);
    console.log(`\n--- Models ---`);
    console.log(`File Agent:       ${config.ollama.fileAgentModel}`);
    console.log(`Ops Agent:        ${config.ollama.opsAgentModel}`);
    console.log(`MCP Servers:      ${config.mcpServers?.join(', ') || 'none'}\n`);
  },

  async organize() {
    const targetPath = args[1];
    if (!targetPath) {
      console.error('Error: Path required. Usage: guardian organize <path>');
      process.exit(1);
    }
    await init();
    const resolvedPath = path.resolve(targetPath);
    console.log(`\nOrganizing: ${resolvedPath}\n`);

    const patterns = patternStore.getTopPatterns(5);
    if (patterns.length > 0) {
      console.log('Using learned patterns:');
      patterns.forEach(p => {
        console.log(`  ${p.source_pattern} -> ${p.target_pattern} (${p.frequency}x)`);
      });
    }

    // Check if Ollama is available
    try {
      const fileAgent = new FileAgent(patternStore);
      await fileAgent.initialize();
      const result = await fileAgent.processRequest(`Organize files in ${resolvedPath}`);
      console.log('\nResult:', result.reasoning);
    } catch (err) {
      console.error('\nOllama not available. Using fallback organization.');
      await fallbackOrganize(resolvedPath);
    }
  },

  async patterns() {
    await init();
    const subCommand = args[1];

    if (subCommand === 'add') {
      const source = args[2];
      const target = args[3];
      if (!source || !target) {
        console.error('Usage: guardian patterns add <sourcePattern> <targetPath>');
        process.exit(1);
      }
      const ext = source.startsWith('*.') ? source.slice(1) : source;
      patternStore.recordPattern('extension', ext, target, [ext]);
      console.log(`Added pattern: ${source} -> ${target}`);
      return;
    }

    const patterns = patternStore.getTopPatterns(20);
    console.log('\n=== Learned Patterns ===\n');
    if (patterns.length === 0) {
      console.log('No patterns learned yet.');
      console.log('Patterns are learned when you organize files.\n');
      return;
    }
    patterns.forEach((p, i) => {
      console.log(`${i + 1}. [${p.pattern_type}] ${p.source_pattern}`);
      console.log(`   -> ${p.target_pattern}`);
      console.log(`   (used ${p.frequency}x, last: ${p.last_used || 'never'})\n`);
    });
  },

  async rules() {
    await init();
    const subCommand = args[1];

    if (subCommand === 'add') {
      const watchPath = args[2];
      const ruleType = args[3] || 'by_extension';
      if (!watchPath) {
        console.error('Usage: guardian rules add <path> [rule_type]');
        process.exit(1);
      }
      const resolved = path.resolve(watchPath);
      try {
        await fs.access(resolved);
        patternStore.addFolderRule(resolved, ruleType, { baseFolder: resolved });
        console.log(`Added rule: ${ruleType} for ${resolved}`);
        console.log('\nRestart the watcher to activate: guardian watch');
      } catch {
        console.error(`Path does not exist: ${resolved}`);
        process.exit(1);
      }
      return;
    }

    const rules = patternStore.getActiveFolderRules();
    console.log('\n=== Auto-Organize Rules ===\n');
    if (rules.length === 0) {
      console.log('No active rules.\n');
      console.log('Add a rule: guardian rules add <path>');
      return;
    }
    rules.forEach((r, i) => {
      console.log(`${i + 1}. [${r.rule_type}] ${r.watch_path}`);
      console.log(`   Active: ${r.active}, Since: ${r.created_at}\n`);
    });
  },

  async watch() {
    await init();
    const watchPath = args[1] || process.cwd();
    console.log(`\nWatching: ${watchPath}`);
    console.log('Press Ctrl+C to stop\n');

    const watcher = new AutoOrganizeWatcher(patternStore);
    await watcher.initialize();

    const rules = patternStore.getActiveFolderRules();
    if (rules.length === 0 && args[1]) {
      await watcher.addRule(watchPath, 'by_extension', { autoLearn: true });
    }

    watcher.onOrganize((result) => {
      const timestamp = new Date().toLocaleTimeString();
      console.log(`[${timestamp}] ${result.action}: ${result.source || result.filePath}`);
    });

    // Keep running
    process.on('SIGINT', async () => {
      console.log('\nStopping watcher...');
      await watcher.close();
      process.exit(0);
    });

    // Prevent exit
    setInterval(() => {}, 1000);
  },

  async scan() {
    const targetPath = args[1];
    if (!targetPath) {
      console.error('Error: Path required. Usage: guardian scan <path>');
      process.exit(1);
    }
    await init();
    const resolvedPath = path.resolve(targetPath);
    const dryRun = args.includes('--dry-run');

    console.log(`\nScanning: ${resolvedPath}${dryRun ? ' (dry run)' : ''}\n`);

    try {
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      const files = entries.filter(e => e.isFile());

      console.log(`Found ${files.length} files\n`);

      const suggestions = [];
      for (const file of files) {
        const ext = path.extname(file.name).toLowerCase();
        const pattern = patternStore.findMatchingPattern(file.name, ext);
        if (pattern) {
          suggestions.push({
            file: file.name,
            currentPath: resolvedPath,
            suggestedPath: pattern.target_pattern.replace('{name}', file.name),
            confidence: pattern.frequency
          });
        }
      }

      if (suggestions.length === 0) {
        console.log('No organization suggestions found.');
        console.log('Learn patterns by organizing files first.\n');
        return;
      }

      console.log('=== Suggestions ===\n');
      suggestions.forEach((s, i) => {
        console.log(`${i + 1}. ${s.file}`);
        console.log(`   -> ${s.suggestedPath}`);
        console.log(`   (confidence: ${s.confidence}x)\n`);
      });

      if (!dryRun) {
        console.log('Run with --dry-run to preview without changes.\n');
      }
    } catch (err) {
      console.error(`Error scanning: ${err.message}`);
    }
  },

  async mcp() {
    const subCommand = args[1];
    await init();

    const opsAgent = new OpsAgent(patternStore);
    await opsAgent.initialize(['system']);

    if (subCommand === 'tools') {
      const tools = opsAgent.listMCPTools();
      console.log('\n=== Available MCP Tools ===\n');
      if (tools.length === 0) {
        console.log('No MCP tools available. Check MCP server connections.\n');
        return;
      }
      tools.forEach((t, i) => {
        console.log(`${i + 1}. ${t.name} (${t.server})`);
        console.log(`   ${t.description?.slice(0, 60) || 'No description'}\n`);
      });
      return;
    }

    if (subCommand === 'call') {
      const toolName = args[2];
      if (!toolName) {
        console.error('Usage: guardian mcp call <tool_name>');
        process.exit(1);
      }
      try {
        const result = await opsAgent.executeMCPTool(toolName, {});
        console.log('\nResult:', JSON.stringify(result, null, 2));
      } catch (err) {
        console.error(`Error: ${err.message}`);
      }
      return;
    }

    console.log('MCP Commands: tools, call <tool>');
  },

  async test() {
    console.log('\n=== Guardian Agents Diagnostics ===\n');

    // Test 1: Pattern Store
    console.log('1. Pattern Store...');
    try {
      await init();
      console.log('   OK - SQLite database connected');
    } catch (err) {
      console.log(`   FAIL - ${err.message}`);
    }

    // Test 2: Ollama
    console.log('2. Ollama Connection...');
    try {
      const { default: ollama } = await import('ollama');
      const models = await ollama.list();
      const hasModel = models.models.some(m => m.name.includes(config.ollama.fileAgentModel));
      if (hasModel) {
        console.log(`   OK - Model ${config.ollama.fileAgentModel} available`);
      } else {
        console.log(`   WARN - Model ${config.ollama.fileAgentModel} not found`);
        console.log('   Run: ollama pull ' + config.ollama.fileAgentModel);
      }
    } catch (err) {
      console.log(`   FAIL - Ollama not running: ${err.message}`);
      console.log('   Start with: ollama serve');
    }

    // Test 3: File System
    console.log('3. File System Access...');
    try {
      const testDir = path.join(process.cwd(), 'containment', 'pending');
      await fs.mkdir(testDir, { recursive: true });
      const testFile = path.join(testDir, `test-${Date.now()}.txt`);
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);
      console.log('   OK - Containment folder writable');
    } catch (err) {
      console.log(`   FAIL - ${err.message}`);
    }

    // Test 4: MCP Client
    console.log('4. MCP Client...');
    try {
      const opsAgent = new OpsAgent(patternStore);
      await opsAgent.initialize(['system']);
      const tools = opsAgent.listMCPTools();
      console.log(`   OK - ${tools.length} tools available`);
      await opsAgent.closeMCP();
    } catch (err) {
      console.log(`   WARN - ${err.message}`);
    }

    console.log('\nDiagnostics complete.\n');
  }
};

// Run command
(async () => {
  try {
    if (commands[command]) {
      await commands[command]();
    } else {
      console.error(`Unknown command: ${command}`);
      console.log('Run "guardian help" for usage.');
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
})();
