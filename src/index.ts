/**
 * TraceRoot SDK for TypeScript
 *
 * Main entry point providing the same API as the Python version:
 * - init() to initialize tracing and logging
 * - trace() decorator for function tracing
 * - get_logger() to get a logger instance
 */

import { _initializeTracing, shutdownTracing, shutdownTracer, forceFlushTracer } from './tracer';
import { trace as traceDecorator, traceFunction } from './tracer';
import { get_logger, initializeLogger, forceFlushLogger, shutdownLogger } from './logger';
import { TraceRootConfig } from './config';
import { TraceOptions } from './types';

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
 * Works for both sync and async usage.
 *
 * Useful for ensuring logs are sent at specific points in your application.
 */
export { forceFlushLogger };

/**
 * Shutdown all logger transports and stop background processes.
 * Works for both sync and async usage.
 *
 * Call this before your application exits to prevent hanging processes.
 */
export { shutdownLogger };

/**
 * Shutdown tracing and flush any pending spans.
 * Forces immediate shutdown and cleanup to prevent hanging.
 *
 * Call this before your application exits to ensure all traces are sent.
 */
export { shutdownTracer };

/**
 * Shutdown tracing and flush any pending spans.
 * Forces immediate shutdown and cleanup to prevent hanging.
 *
 * Call this before your application exits to ensure all traces are sent.
 *
 * @deprecated Use shutdownTracer() instead. This function will be removed in a future version.
 */
export { shutdownTracing };

/**
 * Force flush any pending spans immediately without shutting down.
 * Keeps the tracer running after flushing.
 *
 * Useful for ensuring traces are sent at specific points in your application.
 */
export { forceFlushTracer };

/**
 * Async version of forceFlushTracer that surfaces errors to callers.
 * Use this when you want to handle flush failures explicitly.
 */
export { forceFlushTracerAsync } from './tracer';

/**
 * Synchronous version of forceFlushTracer.
 * Starts the flush process but doesn't wait for completion.
 */
export { forceFlushTracerSync } from './tracer';

/**
 * Synchronous version of shutdownTracer that forces process exit.
 * Use this when you want simple sync-style shutdown without dealing with Promises.
 */
export { shutdownTracerSync } from './tracer';

/**
 * Synchronous version of shutdownTracing that forces process exit.
 * Use this when you want simple sync-style shutdown without dealing with Promises.
 *
 * @deprecated Use shutdownTracerSync() instead. This function will be removed in a future version.
 */
export { shutdownTracingSync } from './tracer';

/**
 * Synchronous version of forceFlushLogger.
 * Starts the flush process but doesn't wait for completion.
 */
export { forceFlushLoggerSync } from './logger';

/**
 * Synchronous version of shutdownLogger.
 * Starts the shutdown process but doesn't wait for completion.
 */
export { shutdownLoggerSync } from './logger';

// Re-export types for convenience
export { TraceRootConfig, TraceRootConfigFile } from './config';
export { TraceOptions, AwsCredentials } from './types';
export { TraceRootLogger } from './logger';

// Re-export constants for convenience
export {
  TELEMETRY_SDK_LANGUAGE,
  TELEMETRY_ATTRIBUTES,
  BATCH_SPAN_PROCESSOR_CONFIG,
} from './constants';

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
