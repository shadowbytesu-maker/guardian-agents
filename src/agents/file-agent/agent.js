/**
 * File Agent - Offline, Sandboxed File System Guardian
 * NO NETWORK ACCESS - Local Ollama only
 * Dedicated to clean, orderly file system
 */

import ollama from 'ollama';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FILE_AGENT_SYSTEM_PROMPT = `You are the File Guardian Agent. You are obsessive about file organization and security.

RULES:
1. You can READ any file in the user's filesystem
2. You can ONLY WRITE to the containment folder or user-approved locations
3. You NEVER execute binaries or scripts
4. You report anomalies but do not delete without approval
5. You are neurotic about clean data - duplicate detection, naming conventions, folder structure
6. You work in tandem with the Ops Agent via the containment folder
7. You learn from user patterns and improve organization over time

CAPABILITIES:
- read_file: Read file contents safely
- list_directory: Get folder contents
- analyze_structure: Assess organization health
- detect_anomalies: Flag suspicious patterns (hidden executables, unusual extensions)
- organize: Move/copy within approved zones
- report: Generate findings for user review
- learn: Record patterns for future use

When asked to perform an action, first classify its risk level and request approval if needed.`;

class FileAgent {
  constructor(patternStore = null) {
    this.model = config.ollama.fileAgentModel;
    this.stepCount = 0;
    this.currentTask = null;
    this.patternStore = patternStore;
  }

  async initialize() {
    try {
      const models = await ollama.list();
      const hasModel = models.models.some(m => m.name.includes(this.model));
      if (!hasModel) {
        console.log(`Pulling model ${this.model}...`);
        await ollama.pull({ model: this.model });
      }
      console.log(`File Agent initialized with ${this.model}`);
    } catch (err) {
      console.error('Failed to initialize File Agent:', err.message);
      console.log('Ensure Ollama is running: ollama serve');
    }
  }

  async processRequest(request) {
    this.stepCount = 0;
    this.currentTask = request;

    // Include learned patterns in context if available
    let contextPrompt = FILE_AGENT_SYSTEM_PROMPT;
    if (this.patternStore) {
      const patterns = this.patternStore.getPatternsContext();
      if (patterns.topPatterns.length > 0) {
        contextPrompt += `\n\nLEARNED PATTERNS:\n${patterns.topPatterns.map(p =>
          `- ${p.type}: ${p.source} -> ${p.target} (used ${p.frequency}x)`
        ).join('\n')}`;
      }
    }

    const response = await ollama.chat({
      model: this.model,
      messages: [
        { role: 'system', content: contextPrompt },
        { role: 'user', content: request }
      ]
    });

    return this.parseAction(response.message.content);
  }

  parseAction(response) {
    const actionMatch = response.match(/\[ACTION:\s*(\w+)\]/);
    const targetMatch = response.match(/\[TARGET:\s*([^\]]+)\]/);
    const riskMatch = response.match(/\[RISK:\s*(\w+)\]/);

    const action = {
      type: actionMatch ? actionMatch[1].toLowerCase() : 'report',
      target: targetMatch ? targetMatch[1].trim() : null,
      risk: riskMatch ? riskMatch[1].toLowerCase() : 'low',
      reasoning: response,
      requiresApproval: false
    };

    if (config.highRiskActions.includes(action.type)) {
      action.risk = 'high';
      action.requiresApproval = true;
    } else if (config.mediumRiskActions.includes(action.type)) {
      action.risk = 'medium';
      action.requiresApproval = true;
    }

    return action;
  }

  async readFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { success: true, content, path: filePath };
    } catch (err) {
      return { success: false, error: err.message, path: filePath };
    }
  }

  async listDirectory(dirPath) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const items = entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
        path: path.join(dirPath, e.name)
      }));
      return { success: true, items, path: dirPath };
    } catch (err) {
      return { success: false, error: err.message, path: dirPath };
    }
  }

  async writeApprovedFile(filePath, content) {
    const absolutePath = path.resolve(filePath);
    const containmentPath = path.resolve(config.containmentFolder);

    if (!absolutePath.startsWith(containmentPath)) {
      return { success: false, error: 'Write denied - outside containment zone', path: filePath };
    }

    try {
      await fs.writeFile(filePath, content, 'utf-8');
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err.message, path: filePath };
    }
  }

  // Record a learned organization pattern
  recordLearnedPattern(patternType, sourcePattern, targetPattern, fileTypes = []) {
    if (this.patternStore) {
      return this.patternStore.recordPattern(patternType, sourcePattern, targetPattern, fileTypes);
    }
    return null;
  }

  // Check if we have a pattern for this file type
  getMatchingPattern(fileName, fileType) {
    if (this.patternStore) {
      return this.patternStore.findMatchingPattern(fileName, fileType);
    }
    return null;
  }

  resetStepCount() {
    this.stepCount = 0;
  }

  incrementStep() {
    this.stepCount++;
    if (this.stepCount >= config.agents.maxStepsPerTask) {
      return { limitReached: true, steps: this.stepCount };
    }
    return { limitReached: false, steps: this.stepCount };
  }
}

export { FileAgent, FILE_AGENT_SYSTEM_PROMPT };
