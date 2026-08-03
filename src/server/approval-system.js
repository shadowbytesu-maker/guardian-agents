/**
 * Approval System - Risk-based action approval
 */

import { config } from '../config/index.js';

class ApprovalSystem {
  constructor() {
    this.pendingApprovals = new Map();
    this.autoApprovedCount = 0;
    this.manualApprovedCount = 0;
    this.deniedCount = 0;
  }

  evaluateAction(action) {
    const result = {
      action,
      riskLevel: 'low',
      requiresApproval: false,
      reason: null,
      autoApproved: false
    };

    // High risk - always needs approval
    if (config.highRiskActions.includes(action.type)) {
      result.riskLevel = 'high';
      result.requiresApproval = true;
      result.reason = `Action "${action.type}" is classified as high-risk`;
      return result;
    }

    // Medium risk - needs approval
    if (config.mediumRiskActions.includes(action.type)) {
      result.riskLevel = 'medium';
      result.requiresApproval = true;
      result.reason = `Action "${action.type}" is classified as medium-risk`;
      return result;
    }

    // Bulk check
    if (action.fileCount && action.fileCount > config.bulkThreshold) {
      result.riskLevel = 'medium';
      result.requiresApproval = true;
      result.reason = `Bulk operation (${action.fileCount} files) exceeds threshold (${config.bulkThreshold})`;
      return result;
    }

    // System path check
    if (action.target) {
      const systemPrefixes = [
        '/etc/', '/usr/', '/bin/', '/sbin/',
        'C:\\Windows', 'C:\\Program Files', 'C:\\ProgramData'
      ];

      for (const prefix of systemPrefixes) {
        if (action.target.startsWith(prefix) || action.target.toLowerCase().startsWith(prefix.toLowerCase())) {
          result.riskLevel = 'high';
          result.requiresApproval = true;
          result.reason = `Target path appears to be a system directory`;
          return result;
        }
      }
    }

    // Auto-approved
    result.autoApproved = true;
    this.autoApprovedCount++;
    return result;
  }

  createApprovalRequest(action) {
    const id = `approval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const request = {
      id,
      action,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 min expiry
    };

    this.pendingApprovals.set(id, request);
    return request;
  }

  async waitForApproval(id) {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const request = this.pendingApprovals.get(id);

        if (!request) {
          clearInterval(checkInterval);
          reject(new Error('Approval request not found'));
          return;
        }

        if (request.status === 'approved') {
          clearInterval(checkInterval);
          this.manualApprovedCount++;
          resolve(true);
        } else if (request.status === 'denied') {
          clearInterval(checkInterval);
          this.deniedCount++;
          resolve(false);
        } else if (new Date() > new Date(request.expiresAt)) {
          clearInterval(checkInterval);
          request.status = 'expired';
          resolve(false);
        }
      }, 500);
    });
  }

  approve(id) {
    const request = this.pendingApprovals.get(id);
    if (request) {
      request.status = 'approved';
      return true;
    }
    return false;
  }

  deny(id) {
    const request = this.pendingApprovals.get(id);
    if (request) {
      request.status = 'denied';
      return true;
    }
    return false;
  }

  getPending() {
    return Array.from(this.pendingApprovals.values())
      .filter(r => r.status === 'pending');
  }

  getStats() {
    return {
      autoApproved: this.autoApprovedCount,
      manualApproved: this.manualApprovedCount,
      denied: this.deniedCount,
      pending: this.pendingApprovals.size
    };
  }
}

export { ApprovalSystem };
