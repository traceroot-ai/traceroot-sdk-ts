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
      console.log('[TraceRoot] Auto-initialization enabled - configResult details:');
      console.log('  Source:', configResult.source);
      console.log('  Config:', JSON.stringify(configResult.config, null, 2));
      console.log('  ConfigFile:', JSON.stringify(configResult.configFile, null, 2));

      // Import init from index.ts to initialize everything (tracer + logger)
      const { init } = require('./index');
      init(configResult.config); // Pass the loaded TypeScript configuration
      return true;
    }

    console.debug('[TraceRoot] Auto-initialization disabled in config');
    return false;
  } catch (error) {
    console.warn('[TraceRoot] Auto-initialization failed:', error);
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
