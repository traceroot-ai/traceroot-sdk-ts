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
      console.debug('[TraceRoot] No config file found, initializing with default configuration');
      // Load default configuration from environment variables
      const { loadConfigFromEnv } = require('./utils/configLoader');
      const defaultConfig = loadConfigFromEnv();

      const { _initializeTracing, getConfig } = require('./tracer');
      const { setGlobalConfig } = require('./logger');

      // Initialize tracer with default config from environment variables
      _initializeTracing(defaultConfig);

      // Initialize logger after tracer to avoid circular dependency
      const configInstance = getConfig();
      if (configInstance) {
        setGlobalConfig(configInstance);
      }
      return true;
    }

    const { configFile } = configResult;

    // Check if auto-initialization is enabled (default: true)
    const shouldAutoInit = configFile?.autoInit !== false;

    if (shouldAutoInit) {
      const { _initializeTracing, getConfig } = require('./tracer');
      const { setGlobalConfig } = require('./logger');

      // Initialize tracer
      _initializeTracing(configResult.config);

      // Initialize logger after tracer to avoid circular dependency
      const configInstance = getConfig();
      if (configInstance) {
        setGlobalConfig(configInstance);
      }
      return true;
    }

    return false;
  } catch (error) {
    console.debug('[TraceRoot] Auto-initialization failed:', error);
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
