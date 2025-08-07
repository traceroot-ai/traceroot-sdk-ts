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
 * Initialize TraceRoot tracing and logging (synchronous).
 *
 * This should be called once at the start of your application.
 *
 * @param config Configuration parameters for TraceRoot
 */
export function init(config?: Partial<TraceRootConfig>): void {
  _initializeTracing(config);

  // Initialize logger after tracer to avoid circular dependency
  const { getConfig } = require('./tracer');
  const configInstance = getConfig();
  if (configInstance) {
    const logger = initializeLogger(configInstance);

    // Verify the logger actually has transports before completing init
    const transportCount = (logger as any).logger.transports.length;

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
 * Get trace headers for the current active span to propagate trace context in HTTP requests.
 * Returns headers that can be used to maintain trace correlation across service boundaries.
 *
 * @returns Object containing trace headers (traceparent, x-trace-id, x-span-id, etc.)
 */
export { getTraceHeaders } from './tracer';

/**
 * Get the current active span ID for debugging purposes.
 *
 * @returns The span ID as a hex string, or null if no active span
 */
export { getSpanId } from './tracer';

/**
 * Check if the current active span is recording.
 *
 * @returns True if there's an active span that is recording, false otherwise
 */
export { isRecording } from './tracer';

/**
 * Get detailed information about the current active span for debugging.
 *
 * @returns Object with trace ID, span ID, and recording status
 */
export { getActiveSpanInfo } from './tracer';

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
export { TraceRootConfig, TraceRootConfigFile } from './config';
export { TraceOptions } from './tracer';
export { TraceRootLogger } from './logger';

// Auto-initialization utilities
export { autoInitialize, shouldAutoInitialize } from './autoInit';

// Import for internal use
import { autoInitialize as _autoInitialize, shouldAutoInitialize } from './autoInit';

// Auto-initialize TraceRoot if config file exists and conditions are met
// This happens when the module is imported (now synchronous)
if (shouldAutoInitialize()) {
  try {
    _autoInitialize();
  } catch (error) {
    // Silently fail auto-initialization - users can still call init() manually
    console.debug('[TraceRoot] Auto-initialization failed:', error);
  }
}
