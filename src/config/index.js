// Guardian Agents Configuration
export const config = {
  // Paths (relative to project root)
  containmentFolder: './containment',
  watchFolder: './containment/pending',
  approvedFolder: './containment/approved',
  logsFolder: './containment/logs',

  // Ollama settings
  ollama: {
    baseUrl: 'http://localhost:11434',
    fileAgentModel: 'llama3.2',      // Offline file agent
    opsAgentModel: 'llama3.2',        // Ops agent (swap to groq for speed)
  },

  // MCP servers to enable (controlled gateways)
  // 'browser' = puppeteer for web automation
  // 'system' = read-only system info
  // 'safe-fetch' = HTTP fetch with domain whitelist
  mcpServers: ['system'],

  // Approval thresholds - actions requiring user confirmation
  highRiskActions: [
    'delete_file',
    'delete_folder',
    'modify_system_path',
    'execute_binary',
    'modify_other_user_files',
    'empty_trash',
    'create_startup_entry',
    'modify_hidden_file'
  ],

  mediumRiskActions: [
    'move_outside_profile',
    'bulk_operation',
    'modify_config_file'
  ],

  // Bulk operation threshold
  bulkThreshold: 10,

  // Agent settings
  agents: {
    maxStepsPerTask: 50,
    cooldownMs: 1000,
    stepLimitBehavior: 'pause_and_report'  // or 'stop'
  },

  // Server
  server: {
    port: 3456
  },

  // Auto-organize settings
  autoOrganize: {
    enabled: false,
    defaultRule: 'by_extension',
    learnPatterns: true,
    operation: 'move'
  }
};

export default config;
