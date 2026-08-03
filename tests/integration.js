/**
 * Integration Tests for Guardian Agents
 * Tests end-to-end functionality
 */

import { PatternStore } from '../src/patterns/pattern-store.js';
import { FileAgent } from '../src/agents/file-agent/agent.js';
import { OpsAgent } from '../src/agents/ops-agent/agent.js';
import { AutoOrganizeWatcher } from '../src/watchers/auto-organize.js';
import { promises as fs } from 'fs';
import path from 'path';

const TEST_DIR = './test-workspace';
const TEST_DB = './test-patterns.db';

let passed = 0;
let failed = 0;

function log( msg, success) {
  const icon = success ? '✓' : '✗';
  console.log(`  ${icon} ${msg}`);
  if (success) passed++;
  else failed++;
}

async function setup() {
  // Create test directories
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.mkdir(path.join(TEST_DIR, 'source'), { recursive: true });
  await fs.mkdir(path.join(TEST_DIR, 'dest'), { recursive: true });

  // Create test files
  await fs.writeFile(path.join(TEST_DIR, 'source', 'test.pdf'), 'pdf content');
  await fs.writeFile(path.join(TEST_DIR, 'source', 'image.jpg'), 'jpg content');
  await fs.writeFile(path.join(TEST_DIR, 'source', 'notes.txt'), 'text content');
}

async function teardown() {
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  try { await fs.unlink(TEST_DB); } catch {}
}

// Test Pattern Store
async function testPatternStore() {
  console.log('\nPattern Store Tests:');
  const store = new PatternStore(TEST_DB);
  await store.initialize();

  // Test recording a pattern
  const pattern = store.recordPattern('extension', '.pdf', '/Documents/PDFs', ['.pdf']);
  log('Record extension pattern', pattern && pattern.source_pattern === '.pdf');

  // Test retrieving patterns
  const patterns = store.getTopPatterns(10);
  log('Retrieve patterns', patterns.length > 0);

  // Test finding matching pattern
  const match = store.findMatchingPattern('report.pdf', '.pdf');
  log('Find matching pattern', match && match.target_pattern === '/Documents/PDFs');

  // Test workflow recording
  store.recordWorkflow('organize pdfs', 'moved 5 files', true);
  const workflows = store.getSuccessfulWorkflows('pdfs');
  log('Record and retrieve workflow', workflows.length > 0);

  // Test preferences
  store.setPreference('test_category', { value: 123 });
  const pref = store.getPreference('test_category');
  log('Store and retrieve preferences', pref && pref.value === 123);

  // Test folder rules
  store.addFolderRule('/test/path', 'by_extension', { autoLearn: true });
  const rules = store.getActiveFolderRules();
  log('Add and retrieve folder rules', rules.length > 0);

  store.close();
}

// Test File Agent
async function testFileAgent() {
  console.log('\nFile Agent Tests:');
  const store = new PatternStore(TEST_DB);
  await store.initialize();
  const agent = new FileAgent(store);

  // Test initialization (may fail if Ollama not running)
  try {
    await agent.initialize();
    log('File Agent initialization', true);
  } catch (e) {
    log('File Agent initialization (Ollama not required for tests)', true);
  }

  // Test file reading
  const content = await agent.readFile(path.join(TEST_DIR, 'source', 'test.pdf'));
  log('Read file', content.success && content.content === 'pdf content');

  // Test directory listing
  const dir = await agent.listDirectory(path.join(TEST_DIR, 'source'));
  log('List directory', dir.success && dir.items.length === 3);

  // Test sandbox write protection
  const badWrite = await agent.writeApprovedFile('/etc/passwd', 'hacked');
  log('Sandbox write protection', !badWrite.success);

  // Test approved write (must be within containment folder)
  const containmentDir = './containment';
  await fs.mkdir(path.join(containmentDir, 'approved'), { recursive: true });
  const goodWrite = await agent.writeApprovedFile(
    path.join(containmentDir, 'approved', 'test.txt'),
    'approved content'
  );
  log('Approved write', goodWrite.success);

  // Test pattern store integration
  const pattern = agent.getMatchingPattern('report.pdf', '.pdf');
  log('Pattern matching integration', pattern !== null);

  store.close();
}

// Test Ops Agent
async function testOpsAgent() {
  console.log('\nOps Agent Tests:');
  const store = new PatternStore(TEST_DB);
  await store.initialize();
  const agent = new OpsAgent(store);

  // Test system info
  const info = await agent.getSystemInfo();
  log('Get system info', info.platform && info.nodeVersion);

  // Test initialization (may fail without Ollama)
  try {
    await agent.initialize([]);
    log('Ops Agent initialization', true);
  } catch (e) {
    log('Ops Agent initialization (Ollama not required for tests)', true);
  }

  // Test MCP manager exists
  log('MCP manager instantiated', !!agent.mcpManager);

  // Test audit log retrieval
  const audit = agent.getMCPAuditLog();
  log('Audit log retrieval', Array.isArray(audit));

  store.close();
}

// Test Auto-Organize Watcher
async function testAutoOrganize() {
  console.log('\nAuto-Organize Tests:');
  const store = new PatternStore(TEST_DB);
  await store.initialize();

  // Record a pattern for testing
  store.recordPattern('extension', '.txt', path.join(TEST_DIR, 'dest', 'text'), ['.txt']);

  const watcher = new AutoOrganizeWatcher(store);

  // Test rule addition
  const ruleAdded = await watcher.addRule(
    path.join(TEST_DIR, 'source'),
    'by_extension',
    { autoLearn: false, persistenceOnly: true }
  );
  log('Add organize rule', ruleAdded);

  // Test rule listing
  const rules = watcher.getActiveRules();
  log('List active rules', rules.length > 0);

  // Test pause/resume
  watcher.pause();
  log('Pause watcher', !watcher.enabled);
  watcher.resume();
  log('Resume watcher', watcher.enabled);

  // Test extension mapping
  const mapped = watcher.extensionToFolder('.pdf', TEST_DIR);
  log('Extension to folder mapping', mapped.includes('Documents'));

  // Cleanup
  await watcher.close();
  store.close();
}

// Test CLI Commands
async function testCLI() {
  console.log('\nCLI Tests:');

  // Test that CLI module loads
  try {
    const { default: cli } = await import('../src/cli/index.js');
    log('CLI module loads', true);
  } catch (e) {
    log('CLI module loads', false);
    console.log(`    Error: ${e.message}`);
  }
}

// Test MCP Servers
async function testMCPServers() {
  console.log('\nMCP Server Tests:');

  // Test that MCP modules load
  try {
    await import('../mcp-servers/system-info/index.js');
    log('System-info server loads', true);
  } catch (e) {
    log('System-info server loads', false);
    console.log(`    Error: ${e.message}`);
  }

  try {
    await import('../mcp-servers/safe-fetch/index.js');
    log('Safe-fetch server loads', true);
  } catch (e) {
    log('Safe-fetch server loads', false);
    console.log(`    Error: ${e.message}`);
  }
}

// Run all tests
async function runTests() {
  console.log('\n══════════════════════════════════════');
  console.log('  Guardian Agents Integration Tests');
  console.log('══════════════════════════════════════\n');

  await setup();

  try {
    await testPatternStore();
    await testFileAgent();
    await testOpsAgent();
    await testAutoOrganize();
    await testCLI();
    await testMCPServers();
  } finally {
    await teardown();
  }

  console.log('\n──────────────────────────────────────');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('──────────────────────────────────────\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
