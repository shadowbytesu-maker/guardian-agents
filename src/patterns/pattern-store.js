/**
 * Pattern Store - Workflow Memory & Learning
 * Stores learned patterns, user preferences, and workflow history
 * Uses SQLite for offline-first, local persistence
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class PatternStore {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(__dirname, '../../data/patterns.db');
    this.db = null;
  }

  async initialize() {
    // Ensure data directory exists
    const dataDir = path.dirname(this.dbPath);
    await fs.mkdir(dataDir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.createTables();
    console.log(`Pattern store initialized at ${this.dbPath}`);
  }

  createTables() {
    // File organization patterns (learned from user behavior)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organization_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_type TEXT NOT NULL,
        source_pattern TEXT NOT NULL UNIQUE,
        target_pattern TEXT NOT NULL,
        file_types TEXT,
        frequency INTEGER DEFAULT 1,
        last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User preferences for file organization
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL UNIQUE,
        preference_data TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Workflow history (what worked, what didn't)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command TEXT NOT NULL,
        action_taken TEXT NOT NULL,
        success INTEGER NOT NULL,
        user_feedback TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Folder rules (auto-organize rules)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS folder_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        watch_path TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        rule_config TEXT NOT NULL,
        active BOOLEAN DEFAULT true,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pattern_type ON organization_patterns(pattern_type);
      CREATE INDEX IF NOT EXISTS idx_frequency ON organization_patterns(frequency DESC);
      CREATE INDEX IF NOT EXISTS idx_workflow_success ON workflow_history(success);
    `);
  }

  // Record a file organization pattern
  recordPattern(patternType, sourcePattern, targetPattern, fileTypes = []) {
    const stmt = this.db.prepare(`
      INSERT INTO organization_patterns
        (pattern_type, source_pattern, target_pattern, file_types)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source_pattern) DO UPDATE SET
        frequency = frequency + 1,
        last_used = CURRENT_TIMESTAMP
    `);

    stmt.run(patternType, sourcePattern, targetPattern, JSON.stringify(fileTypes));
    return this.getPattern(sourcePattern);
  }

  // Get a specific pattern by source
  getPattern(sourcePattern) {
    const stmt = this.db.prepare(`
      SELECT * FROM organization_patterns WHERE source_pattern = ?
    `);
    return stmt.get(sourcePattern);
  }

  // Get most frequently used patterns
  getTopPatterns(limit = 10) {
    const stmt = this.db.prepare(`
      SELECT * FROM organization_patterns
      ORDER BY frequency DESC, last_used DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  }

  // Find matching pattern for a given file
  findMatchingPattern(fileName, fileType) {
    const patterns = this.db.prepare(`
      SELECT * FROM organization_patterns
      WHERE pattern_type = 'extension' AND file_types LIKE ?
      ORDER BY frequency DESC
      LIMIT 1
    `).all(`%${fileType}%`);

    if (patterns.length > 0) {
      return patterns[0];
    }

    // Try filename pattern matching
    const namePatterns = this.db.prepare(`
      SELECT * FROM organization_patterns
      WHERE pattern_type = 'filename' AND ? LIKE source_pattern
      ORDER BY frequency DESC
      LIMIT 1
    `).all(fileName);

    return namePatterns[0] || null;
  }

  // Record workflow execution
  recordWorkflow(command, action, success, feedback = null) {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_history
        (command, action_taken, success, user_feedback)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(command, action, success ? 1 : 0, feedback);
  }

  // Get successful workflows for a command type
  getSuccessfulWorkflows(commandSubstring, limit = 5) {
    const stmt = this.db.prepare(`
      SELECT command, action_taken, COUNT(*) as times_used
      FROM workflow_history
      WHERE command LIKE ? AND success = 1
      GROUP BY action_taken
      ORDER BY times_used DESC
      LIMIT ?
    `);
    return stmt.all(`%${commandSubstring}%`, limit);
  }

  // Set user preference
  setPreference(category, data) {
    const stmt = this.db.prepare(`
      INSERT INTO user_preferences (category, preference_data)
      VALUES (?, ?)
      ON CONFLICT(category) DO UPDATE SET
        preference_data = excluded.preference_data,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(category, JSON.stringify(data));
  }

  // Get user preference
  getPreference(category) {
    const stmt = this.db.prepare(`SELECT preference_data FROM user_preferences WHERE category = ?`);
    const row = stmt.get(category);
    return row ? JSON.parse(row.preference_data) : null;
  }

  // Add folder rule for auto-organize
  addFolderRule(watchPath, ruleType, config) {
    const stmt = this.db.prepare(`
      INSERT INTO folder_rules (watch_path, rule_type, rule_config)
      VALUES (?, ?, ?)
    `);
    return stmt.run(watchPath, ruleType, JSON.stringify(config));
  }

  // Get active folder rules
  getActiveFolderRules() {
    const stmt = this.db.prepare(`SELECT * FROM folder_rules WHERE active = true`);
    return stmt.all();
  }

  // Get patterns summary for agent context
  getPatternsContext() {
    const topPatterns = this.getTopPatterns(10);
    const successRate = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
      FROM workflow_history
    `).get();

    const folderRules = this.getActiveFolderRules();

    return {
      topPatterns: topPatterns.map(p => ({
        type: p.pattern_type,
        source: p.source_pattern,
        target: p.target_pattern,
        frequency: p.frequency
      })),
      successRate: successRate.total > 0
        ? Math.round((successRate.successes / successRate.total) * 100)
        : 0,
      activeRules: folderRules.length,
      recentWorkflows: this.getSuccessfulWorkflows('', 3)
    };
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

export { PatternStore };
