/**
 * TraceRoot SDK for TypeScript
 *
 * Main entry point providing the same API as the Python version:
 * - init() to initialize tracing and logging
 * - trace() decorator for function tracing
 * - get_logger() to get a logger instance
 */

import { _initializeTracing, shutdownTracing, forceFlush } from './tracer';
import { trace as traceDecorator, traceFunction, TraceOptions } from './tracer';
import { get_logger, initializeLogger } from './logger';
import { TraceRootConfig } from './config';

export const VERSION = '0.0.1';

/**
 * Initialize TraceRoot tracing and logging.
 *
 * This should be called once at the start of your application.
 *
 * @param config Configuration parameters for TraceRoot
 */
export async function init(config?: Partial<TraceRootConfig>): Promise<void> {
  await _initializeTracing(config);

  // Initialize logger after tracer to avoid circular dependency
  const { getConfig } = require('./tracer');
  const configInstance = getConfig();
  if (configInstance) {
    const logger = await initializeLogger(configInstance);
    console.log('[DEBUG] Logger initialization completed - CloudWatch transport ready');

    // Verify the logger actually has transports before completing init
    const transportCount = (logger as any).logger.transports.length;
    console.log(`[DEBUG] Logger has ${transportCount} transports ready`);

    if (transportCount === 0) {
      console.warn('[WARNING] Logger has no transports - this may indicate a setup issue');
    }
  }
}

/**
 * Decorator for tracing function execution.
 *
 * @param options Optional tracing configuration
 */
export function trace(options?: TraceOptions) {
  return traceDecorator(options);
}

/**
 * Function wrapper for tracing (alternative to decorator)
 *
 * @param fn Function to wrap with tracing
 * @param options Optional tracing configuration
 */
export { traceFunction };

/**
 * Get a logger instance.
 *
 * @param name Optional logger name
 */
export { get_logger };

/**
 * Flush all pending logs to their destinations.
 *
 * Call this before your application exits to ensure all logs are sent to CloudWatch.
 */
export { flushLogger } from './logger';

/**
 * Shutdown tracing and flush any pending spans.
 *
 * Call this before your application exits to ensure all traces are sent.
 */
export { shutdownTracing };

/**
 * Force flush any pending spans immediately.
 *
 * Useful for ensuring traces are sent at specific points in your application.
 */
export { forceFlush };

// Re-export types for convenience
export { TraceRootConfig, TraceOptions };
export { TraceRootLogger } from './logger';

// Note: Removed automatic initialization on import to avoid double initialization
// Users should call init() explicitly in their application
