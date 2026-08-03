/**
 * Watch Folder Bridge - Command Interface
 * Monitors a folder for user commands (plain language files)
 * Parses and routes to appropriate agent
 */

import chokidar from 'chokidar';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config/index.js';

class WatchFolderBridge {
  constructor(onCommand) {
    this.watchPath = config.watchFolder;
    this.onCommand = onCommand;
    this.watcher = null;
  }

  async start() {
    // Ensure watch folder exists
    await fs.mkdir(this.watchPath, { recursive: true });

    this.watcher = chokidar.watch(this.watchPath, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true
    });

    this.watcher
      .on('add', filePath => this.handleFile(filePath))
      .on('change', filePath => this.handleFile(filePath));

    console.log(`Watching for commands in: ${this.watchPath}`);
    console.log('Drop .txt or .json files to issue commands');
  }

  async handleFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const ext = path.extname(filePath);

      let command;
      if (ext === '.json') {
        command = JSON.parse(content);
      } else {
        // Plain text - treat as direct command
        command = {
          type: 'plain_text',
          content: content.trim(),
          source: 'watch_folder'
        };
      }

      command.receivedAt = new Date().toISOString();
      command.sourceFile = filePath;

      console.log(`Received command from ${path.basename(filePath)}`);

      // Process command
      const result = await this.onCommand(command);

      // Write result to approved folder
      await this.writeResult(filePath, command, result);

      // Remove processed command file
      await fs.unlink(filePath);

    } catch (err) {
      console.error(`Error processing ${filePath}:`, err.message);

      // Move to error folder
      const errorPath = path.join(config.logsFolder, `error-${Date.now()}-${path.basename(filePath)}`);
      await fs.rename(filePath, errorPath).catch(() => {});
    }
  }

  async writeResult(originalPath, command, result) {
    const resultFile = path.join(
      config.approvedFolder,
      `result-${Date.now()}.json`
    );

    await fs.mkdir(config.approvedFolder, { recursive: true });

    await fs.writeFile(resultFile, JSON.stringify({
      command,
      result,
      processedAt: new Date().toISOString()
    }, null, 2));

    console.log(`Result written to: ${resultFile}`);
  }

  async stop() {
    if (this.watcher) {
      await this.watcher.close();
    }
  }
}

export { WatchFolderBridge };
