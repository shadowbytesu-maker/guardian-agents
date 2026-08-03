/**
 * Auto-Organize Watcher
 * Monitors specified folders and automatically organizes files based on learned patterns
 */

import chokidar from 'chokidar';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PatternStore } from '../patterns/pattern-store.js';
import { config } from '../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class AutoOrganizeWatcher {
  constructor(patternStore) {
    this.patternStore = patternStore;
    this.watchers = new Map(); // path -> watcher
    this.processing = new Set(); // prevent duplicate processing
    this.enabled = true;
    this.organizeCallbacks = []; // callbacks for when files are organized
  }

  async initialize() {
    // Load existing folder rules
    const rules = this.patternStore.getActiveFolderRules();

    for (const rule of rules) {
      await this.addRule(rule.watch_path, rule.rule_type, JSON.parse(rule.rule_config));
    }

    console.log(`Auto-organize watcher initialized with ${this.watchers.size} active rules`);
  }

  // Add a folder watch rule
  async addRule(watchPath, ruleType, config) {
    // Verify path exists
    try {
      await fs.access(watchPath);
    } catch {
      console.error(`Watch path does not exist: ${watchPath}`);
      return false;
    }

    // Create watcher
    const watcher = chokidar.watch(watchPath, {
      ignoreInitial: true,
      depth: config.depth || 0,
      ignorePermissionErrors: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollingInterval: 100
      }
    });

    watcher.on('add', (filePath) => this.handleNewFile(filePath, ruleType, config));
    watcher.on('error', (err) => console.error(`Watcher error for ${watchPath}:`, err));

    this.watchers.set(watchPath, { watcher, ruleType, config });
    this.watchers.get(watchPath).active = true;

    // Persist rule to database
    if (!config.persistenceOnly) {
      this.patternStore.addFolderRule(watchPath, ruleType, config);
    }

    console.log(`Added auto-organize rule: ${ruleType} on ${watchPath}`);
    return true;
  }

  // Remove a folder watch rule
  async removeRule(watchPath) {
    const watcherInfo = this.watchers.get(watchPath);
    if (watcherInfo) {
      await watcherInfo.watcher.close();
      this.watchers.delete(watchPath);
      console.log(`Removed auto-organize rule: ${watchPath}`);
      return true;
    }
    return false;
  }

  // Handle new file detection
  async handleNewFile(filePath, ruleType, ruleConfig) {
    if (!this.enabled) return;
    if (this.processing.has(filePath)) return;

    this.processing.add(filePath);

    try {
      const fileName = path.basename(filePath);
      const ext = path.extname(fileName).toLowerCase();
      const dir = path.dirname(filePath);

      console.log(`Auto-organize: New file detected: ${fileName}`);

      // Find matching pattern
      const pattern = this.patternStore.findMatchingPattern(fileName, ext);

      let result = null;

      if (pattern) {
        // Use learned pattern
        result = await this.applyPattern(filePath, pattern, ruleConfig);
      } else if (ruleConfig.autoLearn) {
        // Learn new organization
        result = await this.learnOrganization(filePath, ruleConfig);
      } else {
        // Use rule config defaults
        result = await this.applyDefaultRule(filePath, ruleType, ruleConfig);
      }

      // Notify callbacks
      if (result) {
        this.organizeCallbacks.forEach(cb => cb(result));
      }

    } catch (err) {
      console.error(`Auto-organize error for ${filePath}:`, err.message);
    } finally {
      this.processing.delete(filePath);
    }
  }

  // Apply a learned pattern
  async applyPattern(filePath, pattern, config) {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    let targetPattern = pattern.target_pattern;

    // Substitute variables
    targetPattern = targetPattern.replace('{ext}', ext.replace('.', ''));
    targetPattern = targetPattern.replace('{name}', fileName);
    targetPattern = targetPattern.replace('{date}', new Date().toISOString().split('T')[0]);

    const targetPath = path.resolve(targetPattern);

    // Safety check
    if (!config.allowMove && !targetPath.startsWith(config.containmentFolder || config.watchFolder)) {
      console.log(`Pattern suggests move outside safe zone: ${targetPath}`);
      return { action: 'blocked', reason: 'target_outside_safe_zone', filePath };
    }

    // Ensure target directory exists
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    // Move or copy
    if (config.operation === 'copy') {
      await fs.copyFile(filePath, targetPath);
    } else {
      await fs.rename(filePath, targetPath);
    }

    // Update pattern frequency
    this.patternStore.recordPattern(
      pattern.pattern_type,
      pattern.source_pattern,
      pattern.target_pattern,
      [ext]
    );

    console.log(`Applied pattern: ${fileName} -> ${targetPath}`);
    return {
      action: 'organized',
      source: filePath,
      target: targetPath,
      pattern: pattern.pattern_type,
    };
  }

  // Learn organization from user behavior or rules
  async learnOrganization(filePath, config) {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);

    // Determine target based on extension
    let targetFolder;

    if (config.organizeByExtension) {
      targetFolder = this.extensionToFolder(ext, config.baseFolder);
    } else if (config.baseFolder) {
      targetFolder = path.join(config.baseFolder, 'organized', ext.replace('.', ''));
    } else {
      // Use containment folder as fallback
      targetFolder = path.join(config.containmentFolder || this.watchFolder, 'organized');
    }

    const targetPath = path.join(targetFolder, fileName);
    await fs.mkdir(targetFolder, { recursive: true });

    if (config.operation !== 'copy') {
      await fs.rename(filePath, targetPath);
    } else {
      await fs.copyFile(filePath, targetPath);
    }

    // Record this as a new pattern
    this.patternStore.recordPattern(
      'extension',
      ext,
      path.join(targetFolder, '{name}'),
      [ext]
    );

    return {
      action: 'learned_and_organized',
      source: filePath,
      target: targetPath,
    };
  }

  // Apply default rule when no pattern matches
  async applyDefaultRule(filePath, ruleType, config) {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    switch (ruleType) {
      case 'by_extension':
        return this.learnOrganization(filePath, {
          ...config,
          organizeByExtension: true
        });

      case 'by_date':
        const dateFolder = path.join(
          config.baseFolder || config.watchFolder,
          new Date().toISOString().split('T')[0]
        );
        await fs.mkdir(dateFolder, { recursive: true });
        await fs.rename(filePath, path.join(dateFolder, fileName));
        return { action: 'dated', source: filePath, target: path.join(dateFolder, fileName) };

      case 'hold':
        // Don't organize, just log
        return { action: 'held', filePath };

      default:
        console.log(`Unknown rule type: ${ruleType}, holding file`);
        return { action: 'held', filePath };
    }
  }

  // Map extension to folder name
  extensionToFolder(ext, baseFolder) {
    const extensionMap = {
      // Documents
      '.pdf': 'Documents/PDFs',
      '.doc': 'Documents/Word',
      '.docx': 'Documents/Word',
      '.txt': 'Documents/Text',
      '.md': 'Documents/Markdown',

      // Images
      '.jpg': 'Images/Photos',
      '.jpeg': 'Images/Photos',
      '.png': 'Images/Screenshots',
      '.gif': 'Images/GIFs',
      '.svg': 'Images/Vectors',

      // Videos
      '.mp4': 'Videos',
      '.mov': 'Videos',
      '.avi': 'Videos',
      '.mkv': 'Videos',

      // Audio
      '.mp3': 'Audio/Music',
      '.wav': 'Audio/Samples',
      '.flac': 'Audio/Music',

      // Archives
      '.zip': 'Archives',
      '.tar': 'Archives',
      '.gz': 'Archives',
      '.rar': 'Archives',

      // Code
      '.js': 'Code/JavaScript',
      '.ts': 'Code/TypeScript',
      '.py': 'Code/Python',
      '.go': 'Code/Go',
      '.rs': 'Code/Rust',
      '.java': 'Code/Java',

      // Data
      '.json': 'Data/JSON',
      '.csv': 'Data/CSV',
      '.yaml': 'Data/Config',
      '.yml': 'Data/Config',
    };

    const subfolder = extensionMap[ext] || 'Other';
    return path.join(baseFolder || process.cwd(), subfolder);
  }

  // Register callback for organize events
  onOrganize(callback) {
    this.organizeCallbacks.push(callback);
  }

  // Get all active rules
  getActiveRules() {
    const rules = [];
    this.watchers.forEach(({ ruleType, config, active }, watchPath) => {
      rules.push({ watchPath, ruleType, active, config });
    });
    return rules;
  }

  // Pause/resume
  pause() {
    this.enabled = false;
    console.log('Auto-organize paused');
  }

  resume() {
    this.enabled = true;
    console.log('Auto-organize resumed');
  }

  // Cleanup
  async close() {
    for (const [_, { watcher }] of this.watchers) {
      await watcher.close();
    }
    this.watchers.clear();
    console.log('Auto-organize watcher closed');
  }
}

export { AutoOrganizeWatcher };
