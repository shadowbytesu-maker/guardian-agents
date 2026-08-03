# Guardian Agents

**Local autonomous file system agents with MCP orchestration**

Two AI agents work in tandem to organize, monitor, and manage your files - entirely offline with controlled network access.

---

## Features

### Core Capabilities
- **Offline-First**: Runs entirely locally with Ollama (no cloud required)
- **Dual-Agent Architecture**: File Agent for sandboxed operations, Ops Agent for external access
- **Pattern Learning**: Learns your file organization preferences over time
- **Auto-Organize**: Watch folders and automatically organize files based on learned patterns
- **MCP Integration**: Controlled, audited access to external tools and networks
- **Approval System**: High-risk actions require explicit confirmation

### What's New in v0.1.0
- SQLite pattern storage for workflow memory
- MCP client for controlled external access
- Auto-organize watcher with folder rules
- CLI interface for direct commands
- Full web dashboard with pattern/rule management
- Integration test suite

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER INTERFACE                                 │
│                    http://localhost:3456                                 │
│                    CLI: guardian <command>                               │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      GUARDIAN ORCHESTRATOR                               │
│  • Routes commands to agents                                             │
│  • Manages approval queue                                                 │
│  • WebSocket real-time updates                                           │
│  • Pattern Store (workflow memory)                                       │
│  • Auto-Organize Watcher                                                  │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
┌───────────────────────────┐    ┌────────────────────────────────────────┐
│       FILE AGENT          │    │            OPS AGENT                    │
│       (OFFLINE)           │    │        (MCP-CONNECTED)                 │
│                           │    │                                        │
│  ✓ Read/write files       │    │  ✓ MCP CLIENT MANAGER                 │
│  ✓ Organize folders       │    │    └─ browser (puppeteer)             │
│  ✓ Detect anomalies       │    │    └─ safe-fetch (whitelisted)        │
│  ✓ Sandbox contained      │    │    └─ system-info (read-only)          │
│  ✓ Learns patterns        │    │  ✓ Browser automation                 │
│                           │    │  ✓ Research & fetch                    │
│  ✗ NO NETWORK ACCESS      │    │  ✓ AUDITED network calls              │
└─────────────┬─────────────┘    └─────────────────┬──────────────────────┘
              │                                    │
              └─────────────────┬──────────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │      CONTAINMENT FOLDER       │
                 │     (Shared workspace)        │
                 ├──────────────────────────────┤
                 │  pending/  - Drop commands   │
                 │  approved/ - Results appear  │
                 │  logs/     - Error logs      │
                 └──────────────────────────────┘
                                │
                                ▼
                 ┌──────────────────────────────┐
                 │       PATTERN STORE          │
                 │      (SQLite Database)       │
                 ├──────────────────────────────┤
                 │  • Organization patterns     │
                 │  • User preferences           │
                 │  • Workflow history           │
                 │  • Auto-organize rules        │
                 └──────────────────────────────┘
```

---

## Quick Start

### Prerequisites
- **Node.js** 18+
- **Ollama** (https://ollama.ai) - for AI models
- Native build tools (for better-sqlite3)

### Installation

```bash
# 1. Install Ollama and download model
ollama pull llama3.2

# 2. Clone and install
git clone <repo-url>
cd guardian-agents
npm install

# 3. Start the server
npm run dev

# 4. Open dashboard
open http://localhost:3456
```

---

## Usage

### Web Dashboard

The web interface at `http://localhost:3456` provides:

| Tab | Description |
|-----|-------------|
| **Dashboard** | Command input, activity log, system status |
| **Patterns** | View and manage learned organization patterns |
| **Auto-Organize** | Configure folder watching rules |
| **MCP Tools** | Browse available MCP tools and audit log |
| **Approvals** | Review and approve pending actions |

### CLI Commands

```bash
# System status
npm run cli status

# Organize a folder
npm run cli organize ~/Downloads

# View learned patterns
npm run cli patterns

# Add a pattern
npm run cli patterns add "*.pdf" "~/Documents/PDFs"

# Add auto-organize rule
npm run cli rules add ~/Downloads --type by_extension

# Watch a folder for changes
npm run cli watch ~/Downloads

# Scan for organization suggestions
npm run cli scan ~/Documents --dry-run

# List MCP tools
npm run cli mcp tools

# Run diagnostics
npm run cli test
```

### File Watcher

Drop `.txt` files containing commands into:
```
containment/pending/
```

Results appear in:
```
containment/approved/
```

---

## API Reference

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | System health check |
| `/api/command` | POST | Submit a command |
| `/api/approvals` | GET | List pending approvals |
| `/api/approvals/:id/approve` | POST | Approve an action |
| `/api/approvals/:id/deny` | POST | Deny an action |
| `/api/files/read` | POST | Read a file |
| `/api/files/list` | GET | List directory |
| `/api/agents/status` | GET | Agent status |
| `/api/config` | GET | Configuration |
| `/api/patterns` | GET | Get pattern context |
| `/api/patterns/top` | GET | Top patterns |
| `/api/patterns/record` | POST | Record a pattern |
| `/api/mcp/tools` | GET | List MCP tools |
| `/api/mcp/audit` | GET | MCP audit log |
| `/api/mcp/execute` | POST | Execute MCP tool |
| `/api/organize/rules` | GET | List auto-organize rules |
| `/api/organize/rules` | POST | Add a rule |
| `/api/organize/rules` | DELETE | Remove a rule |
| `/api/organize/pause` | POST | Pause auto-organize |
| `/api/organize/resume` | POST | Resume auto-organize |

### WebSocket

Connect to `ws://localhost:3457` for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:3457');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'init':           // Initial state
    case 'result':        // Command result
    case 'approval_request': // Action needs approval
    case 'error':         // Error occurred
  }
};
```

---

## Configuration

Edit `src/config/index.js`:

```javascript
export const config = {
  // Paths
  containmentFolder: '../containment',
  watchFolder: '../containment/pending',

  // Ollama models
  ollama: {
    baseUrl: 'http://localhost:11434',
    fileAgentModel: 'llama3.2',
    opsAgentModel: 'llama3.2',
  },

  // MCP servers to enable
  mcpServers: ['system'],

  // Risk thresholds
  highRiskActions: ['delete_file', 'delete_folder', ...],
  mediumRiskActions: ['move_outside_profile', ...],

  // Bulk operation threshold
  bulkThreshold: 10,

  // Agent limits
  agents: {
    maxStepsPerTask: 50,
    cooldownMs: 1000,
  },

  // Server ports
  server: {
    port: 3456,
    wsPort: 3457
  },

  // Auto-organize settings
  autoOrganize: {
    enabled: false,
    defaultRule: 'by_extension',
    learnPatterns: true,
  }
};
```

---

## MCP Architecture

Guardian Agents uses MCP (Model Context Protocol) for controlled external access.

### Available MCP Servers

| Server | Access | Description |
|--------|--------|-------------|
| `browser` | Internet | Puppeteer-based web automation |
| `safe-fetch` | Whitelisted domains | HTTP fetch with domain restrictions |
| `system` | Local only | Read-only system information |

### Domain Whitelist (safe-fetch)

```
github.com, api.github.com, raw.githubusercontent.com
registry.npmjs.org, api.npmjs.org
pypi.org, files.pythonhosted.org
crates.io, static.crates.io
rubygems.org, api.rubygems.org
```

### Adding MCP Servers

Create a new server in `mcp-servers/<name>/index.js`:

```javascript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server(
  { name: 'my-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler('tools/list', async () => ({
  tools: [{ name: 'my_tool', description: '...', inputSchema: {...} }]
}));

server.setRequestHandler('tools/call', async (request) => {
  // Handle tool call
});

const transport = new StdioServerTransport();
server.connect(transport);
```

---

## Testing

### Run Integration Tests

```bash
npm run test
```

### Test Coverage

| Module | Tests |
|--------|-------|
| Pattern Store | Record, retrieve, match patterns |
| File Agent | Read, write, sandbox protection |
| Ops Agent | System info, MCP manager |
| Auto-Organize | Rules, watching, mapping |
| CLI | Module loading |
| MCP Servers | Module loading |

### Manual Testing

```bash
# Test pattern store
npm run cli patterns add "*.pdf" "~/Documents/PDFs"
npm run cli patterns

# Test auto-organize
npm run cli rules add ~/test-folder --type by_extension
npm run cli watch ~/test-folder

# Test MCP
npm run cli mcp tools
npm run cli mcp call get_system_info
```

---

## File Structure

```
guardian-agents/
├── src/
│   ├── agents/
│   │   ├── file-agent/
│   │   │   └── agent.js         # Offline file operations
│   │   └── ops-agent/
│   │       ├── agent.js         # Coordination & MCP
│   │       └── mcp-client.js    # MCP server connections
│   ├── bridge/
│   │   └── watch-folder.js      # File command watcher
│   ├── cli/
│   │   └── index.js             # CLI interface
│   ├── config/
│   │   └── index.js             # Configuration
│   ├── patterns/
│   │   └── pattern-store.js     # SQLite pattern storage
│   ├── server/
│   │   ├── index.js             # Main orchestrator
│   │   └── approval-system.js   # Action approvals
│   ├── ui/
│   │   └── public/
│   │       └── index.html       # Web dashboard
│   ├── utils/
│   │   └── error-recovery.js    # Fault tolerance
│   └── watchers/
│       └── auto-organize.js     # File organization watcher
├── mcp-servers/
│   ├── system-info/
│   │   └── index.js             # System info MCP server
│   ├── safe-fetch/
│   │   └── index.js             # Whitelisted HTTP fetch
│   └── sandboxed-fs/
│       └── index.js             # Contained file system
├── tests/
│   └── integration.js           # Integration test suite
├── containment/
│   ├── pending/                 # Drop commands here
│   ├── approved/                # Results appear here
│   └── logs/                    # Error logs
├── data/
│   └── patterns.db              # SQLite database
└── package.json
```

---

## Security Design

### Principles

1. **Sandbox Isolation**: File Agent can only write to containment folder
2. **Network Separation**: File Agent has zero network access
3. **Audit Logging**: All MCP calls logged with timestamps
4. **Domain Whitelisting**: Network requests restricted to allowed domains
5. **Approval System**: High-risk actions require user confirmation
6. **Step Limits**: Prevent runaway operations

### Safety Layers (Defense in Depth)

The architecture implements 12 distinct safety layers - if one fails, others catch it:

| Layer | Component | Protection |
|-------|-----------|------------|
| 1. Agent Separation | `file-agent/` vs `ops-agent/` | File Agent has zero network access |
| 2. Containment Sandbox | `agent.js:134-147` | File Agent can ONLY write to `./containment/` |
| 3. Risk Classification | `approval-system.js:15-45` | Actions tagged low/medium/high risk |
| 4. Manual Approval | `approval-system.js` | High/medium risks require user confirmation |
| 5. System Path Protection | `approval-system.js:49-63` | Blocks `/etc/`, `/usr/`, `C:\Windows`, etc. |
| 6. Domain Whitelist | `safe-fetch/index.js:12-18` | Network restricted to 12 approved domains |
| 7. MCP Audit Logging | `mcp-client.js:136-167` | All external calls logged with timestamps |
| 8. Step Limits | `config:45` | Max 50 steps per task prevents runaway ops |
| 9. Bulk Threshold | `approval-system.js:41-46` | Operations on 10+ files require approval |
| 10. Cooldown | `config:47` | 1000ms delay between agent actions |
| 11. Approval Expiry | `approval-system.js:79` | Pending approvals expire in 5 minutes |
| 12. Containment Workspace | Physical folder separation | `pending/` for commands, `approved/` for results |

### Risk Classification

| Risk Level | Actions | Approval Required |
|------------|---------|-------------------|
| **Low** | Read, list, create folder | Auto-approved |
| **Medium** | Move outside profile, bulk ops | Yes |
| **High** | Delete, execute, modify system | Yes |

---

## Troubleshooting

### Common Issues

**Ollama not running**
```
Error: Failed to initialize File Agent
Solution: Run `ollama serve`
```

**Model not found**
```
Error: Model llama3.2 not found
Solution: Run `ollama pull llama3.2`
```

**SQLite build fails**
```
Error: Could not build better-sqlite3
Solution: Install build tools (python3, make, g++)
  - Ubuntu: sudo apt install build-essential python3
  - macOS: xcode-select --install
  - Windows: npm install windows-build-tools
```

**Port in use**
```
Error: EADDRINUSE: address already in use :::3456
Solution: Change port in config or kill process using port
```

### Diagnostics

```bash
# Run diagnostic tests
npm run cli test

# Check Ollama status
ollama list

# Check MCP servers
npm run cli mcp tools
```

---

## Roadmap

### v0.2.0 (Planned)
- [ ] Import/export patterns
- [ ] Custom MCP server hot-reload
- [ ] Undo/redo for file operations
- [ ] Notification system

### v0.3.0 (Planned)
- [ ] Multi-user support
- [ ] Encrypted pattern storage
- [ ] Cloud sync (optional)
- [ ] Plugin system

---

## Monetization Options

Potential revenue models for Guardian Agents:

### Open Source Core (Recommended for Growth)
- **Free & Open Source** - MIT license, community-driven
- Revenue from: consulting, custom integrations, enterprise support contracts

### Freemium Model
- **Free Tier**: Local-only, basic file organization, standard MCP servers
- **Pro Tier** ($10-20/mo): Cloud sync, advanced pattern sharing, priority MCP servers
- **Enterprise Tier**: Custom deployment, SSO, audit compliance, dedicated support

### One-Time Purchase
- **Personal License** ($29-49): Full local features, lifetime updates
- **Team License** ($149-299): Multi-user support, shared patterns, team dashboard

### Usage-Based
- **Pay-per-AI-call**: Micro-transactions for Ollama API proxy (cloud fallback)
- **Volume Tiers**: Based on files processed per month

### Enterprise Licensing
- **Self-Hosted** ($500-2000/yr): On-prem deployment, unlimited users
- **Managed Cloud** ($20-50/user/mo): We host, you manage
- **White-Label**: OEM licensing for integration into other products

### Add-On Services
- Custom MCP server development
- Organization consulting & setup
- Training data curation for domain-specific patterns
- Integration with existing workflow tools

### Considerations
- Open source builds trust and community
- Local-first architecture reduces hosting costs
- Enterprise features (SSO, audit logs) justify B2B pricing
- Consider usage caps vs unlimited models

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `npm run test`
4. Submit a pull request

---

## License

MIT License - See LICENSE file for details.

---

## Acknowledgments

- Built with [Ollama](https://ollama.ai) for local AI
- Uses [MCP](https://modelcontextprotocol.io) for controlled external access
- Pattern storage via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
