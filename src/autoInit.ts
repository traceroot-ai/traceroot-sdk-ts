/**
 * Auto-initialization module for TraceRoot
 * Similar to how Sentry can auto-initialize from configuration
 */

import { findAndLoadConfigSync } from './utils/config';

/**
 * Automatically initialize TraceRoot if a configuration file is found
 * and autoInit is enabled (default: true) - synchronous version
 */
export function autoInitialize(): boolean {
  try {
    const configResult = findAndLoadConfigSync();

    if (!configResult) {
      console.debug('[TraceRoot] No config file found, skipping auto-initialization');
      return false; // No config found
    }

    const { configFile } = configResult;

    // Check if auto-initialization is enabled (default: true)
    const shouldAutoInit = configFile?.autoInit !== false;

    if (shouldAutoInit) {
      const { _initializeTracing, getConfig } = require('./tracer');
      const { initializeLogger } = require('./logger');

      // Initialize tracer
      _initializeTracing(configResult.config);

      // Initialize logger after tracer to avoid circular dependency
      const configInstance = getConfig();
      if (configInstance) {
        const logger = initializeLogger(configInstance);

        // Verify the logger actually has transports before completing init
        const transportCount = (logger as any).logger.transports.length;

        if (transportCount === 0) {
          console.warn('[TraceRoot] Logger has no transports - this may indicate a setup issue');
        }
      }
      return true;
    }

    return false;
  } catch (error) {
    void error;
    return false;
  }
}

/**
 * Check if TraceRoot should auto-initialize based on environment variables
 */
export function shouldAutoInitialize(): boolean {
  // Allow disabling auto-init via environment variable
  const disableAutoInit = process.env.TRACEROOT_DISABLE_AUTO_INIT === 'true';
  return !disableAutoInit;
}

// Note: Auto-initialization is now handled in index.ts to avoid circular imports
