/**
 * Error Recovery and Robustness Module
 * Provides graceful degradation, retry logic, and fault tolerance
 */

class ErrorRecovery {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.exponentialBackoff = options.exponentialBackoff !== false;
    this.errors = [];
    this.degradedMode = false;
  }

  // Execute with automatic retry
  async withRetry(operation, name = 'operation') {
    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        this.logError(name, err, attempt);

        if (attempt < this.maxRetries) {
          const delay = this.exponentialBackoff
            ? this.retryDelay * Math.pow(2, attempt - 1)
            : this.retryDelay;

          console.log(`Retry ${attempt}/${this.maxRetries} for ${name} in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  // Execute with fallback
  async withFallback(operation, fallback, name = 'operation') {
    try {
      return await operation();
    } catch (err) {
      this.logError(name, err);
      console.log(`Using fallback for ${name}`);
      this.degradedMode = true;
      return await fallback();
    }
  }

  // Circuit breaker pattern
  createCircuitBreaker(operation, options = {}) {
    const threshold = options.failureThreshold || 5;
    const timeout = options.resetTimeout || 30000;
    let failures = 0;
    let lastFailureTime = 0;
    let isOpen = false;

    return async (...args) => {
      if (isOpen) {
        if (Date.now() - lastFailureTime > timeout) {
          isOpen = false;
          failures = 0;
        } else {
          throw new Error('Circuit breaker is open');
        }
      }

      try {
        const result = await operation(...args);
        failures = 0;
        return result;
      } catch (err) {
        failures++;
        lastFailureTime = Date.now();

        if (failures >= threshold) {
          isOpen = true;
          console.log(`Circuit breaker opened for ${operation.name || 'operation'}`);
        }

        throw err;
      }
    };
  }

  // Timeout wrapper
  async withTimeout(operation, timeoutMs, name = 'operation') {
    return Promise.race([
      operation(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  // Log error
  logError(operation, error, attempt = null) {
    const entry = {
      operation,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      attempt
    };
    this.errors.push(entry);

    // Keep only last 100 errors
    if (this.errors.length > 100) {
      this.errors.shift();
    }
  }

  // Get error history
  getErrors(limit = 20) {
    return this.errors.slice(-limit);
  }

  // Check if in degraded mode
  isDegraded() {
    return this.degradedMode;
  }

  // Reset degraded mode
  reset() {
    this.degradedMode = false;
  }

  // Helper
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Global error handler for uncaught exceptions
function setupGlobalErrorHandling() {
  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
    console.error('Stack:', err.stack);
    // Don't exit in production, try to recover
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
  });
}

// Graceful shutdown helper
function setupGracefulShutdown(handlers = []) {
  const shutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    for (const handler of handlers) {
      try {
        await handler();
      } catch (err) {
        console.error('Shutdown handler error:', err.message);
      }
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export { ErrorRecovery, setupGlobalErrorHandling, setupGracefulShutdown };
