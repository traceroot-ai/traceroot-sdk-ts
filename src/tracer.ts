import { trace as otelTrace, SpanStatusCode, Span } from '@opentelemetry/api';
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { TraceRootConfig, TraceRootConfigImpl } from './config';

// Global state
let _tracerProvider: NodeTracerProvider | null = null;
let _config: TraceRootConfigImpl | null = null;
let _isShuttingDown: boolean = false;

export interface TraceOptions {
  spanName?: string;
  spanNameSuffix?: string;
  traceParams?: boolean | string[];
  traceReturnValue?: boolean;
  flattenAttributes?: boolean;
}

export class TraceOptionsImpl implements TraceOptions {
  spanName?: string;
  spanNameSuffix?: string;
  traceParams: boolean | string[] = false;
  traceReturnValue: boolean = false;
  flattenAttributes: boolean = true;

  constructor(options: TraceOptions = {}) {
    Object.assign(this, options);
  }

  getSpanName(fn: Function): string {
    if (this.spanName) {
      return this.spanName;
    }
    if (this.spanNameSuffix) {
      return `${fn.name}${this.spanNameSuffix}`;
    }
    return fn.name || 'anonymous';
  }
}

interface AwsCredentials {
  aws_access_key_id: string;
  aws_secret_access_key: string;
  aws_session_token: string;
  region: string;
  hash: string;
  expiration_utc: Date;
  otlp_endpoint: string;
}

/**
 * Fetch AWS credentials from TraceRoot API (synchronous using sync HTTP)
 */
function fetchAwsCredentialsSync(config: TraceRootConfigImpl): AwsCredentials | null {
  if (!config.token) {
    console.log('[TraceRoot] No token provided, skipping AWS credentials fetch');
    return null;
  }

  try {
    const apiUrl = `https://api.test.traceroot.ai/v1/verify/credentials?token=${encodeURIComponent(config.token)}`;

    // Create a synchronous HTTP request using child_process
    const { execSync } = require('child_process');

    try {
      const curlCommand = `curl -s -H "Content-Type: application/json" "${apiUrl}"`;
      const response = execSync(curlCommand, { timeout: 5000, encoding: 'utf8' });
      const credentials = JSON.parse(response);
      return credentials;
    } catch (error: any) {
      void error;
      return null;
    }
  } catch (error: any) {
    void error;
    return null;
  }
}

/**
 * Initialize TraceRoot tracing and logging (synchronous).
 *
 * This is the main entry point for setting up tracing and logging.
 * Call this once at the start of your application.
 */
export function _initializeTracing(kwargs: Partial<TraceRootConfig> = {}): NodeTracerProvider {
  // Check if already initialized
  if (_tracerProvider !== null) {
    console.log('[TraceRoot] Tracer already initialized, returning existing instance');
    return _tracerProvider;
  }
  // Merge file config with kwargs (kwargs take precedence)
  let configParams: Partial<TraceRootConfig> = kwargs;

  if (Object.keys(configParams).length === 0) {
    throw new Error('No configuration provided for TraceRoot initialization');
  }

  // Fill in missing fields with some default values if not provided
  if (!configParams.service_name) {
    configParams.service_name = 'N/A';
  }
  if (!configParams.github_owner) {
    configParams.github_owner = 'N/A';
  }
  if (!configParams.github_repo_name) {
    configParams.github_repo_name = 'N/A';
  }
  if (!configParams.github_commit_hash) {
    configParams.github_commit_hash = 'N/A';
  }

  const config = new TraceRootConfigImpl(configParams as TraceRootConfig);

  // If not in local mode, fetch AWS credentials and update config before creating tracer
  if (!config.local_mode) {
    const credentials = fetchAwsCredentialsSync(config);
    if (credentials) {
      // Update config with fetched credentials
      config._name = credentials.hash;
      config.otlp_endpoint = credentials.otlp_endpoint;

      // Store credentials in config for logger to use later
      (config as any)._awsCredentials = credentials;
    } else {
      console.log(`[TraceRoot] Using default configuration (no AWS credentials)`);
    }
  }

  _config = config;

  // Test OTLP endpoint connectivity (skip in tests to avoid async issues)
  if (config.local_mode && process.env.NODE_ENV !== 'test') {
    const axios = require('axios');
    axios
      .get(config.otlp_endpoint.replace('/v1/traces', '/health'))
      .then(() => console.log(`[TraceRoot] OTLP endpoint is reachable`))
      .catch((err: any) => console.log(`[TraceRoot] OTLP endpoint check failed:`, err.message));
  }

  // Logger will be initialized separately to avoid circular dependency

  // Create resource with service information using new semantic conventions
  const resource = Resource.default().merge(
    new Resource({
      [ATTR_SERVICE_NAME]: config.service_name,
      [ATTR_SERVICE_VERSION]: config.github_commit_hash,
      'service.github_owner': config.github_owner,
      'service.github_repo_name': config.github_repo_name,
      'service.environment': config.environment,
      'telemetry.sdk.language': 'ts',
    })
  );

  // Create trace exporter with debugging - now using the correct endpoint
  const traceExporter = new OTLPTraceExporter({
    url: config.otlp_endpoint,
  });

  // Add debugging to the exporter
  const originalExport = traceExporter.export.bind(traceExporter);
  traceExporter.export = function (spans: any, resultCallback: any) {
    return originalExport(spans, (result: any) => {
      resultCallback(result);
    });
  };

  // Create span processor - in local mode, use SimpleSpanProcessor for immediate export when span ends
  // This ensures spans are only exported when their function actually completes
  const spanProcessor = config.local_mode
    ? new SimpleSpanProcessor(traceExporter)
    : new BatchSpanProcessor(traceExporter, {
        maxExportBatchSize: 10,
        exportTimeoutMillis: 5000,
        scheduledDelayMillis: 500,
        maxQueueSize: 100,
      });

  // Prepare span processors array
  const spanProcessors = [spanProcessor];

  // If console export is enabled, add console span processor with same type as main processor
  if (config.enable_span_console_export) {
    const consoleExporter = new ConsoleSpanExporter();
    const consoleProcessor = config.local_mode
      ? new SimpleSpanProcessor(consoleExporter)
      : new BatchSpanProcessor(consoleExporter, {
          maxExportBatchSize: 10,
          exportTimeoutMillis: 5000,
          scheduledDelayMillis: 500,
          maxQueueSize: 100,
        });
    spanProcessors.push(consoleProcessor);
  }

  // Create and configure the tracer provider with span processors
  _tracerProvider = new NodeTracerProvider({
    resource: resource,
    spanProcessors: spanProcessors,
  });

  // Register the tracer provider globally
  _tracerProvider.register();

  // Set up automatic cleanup on process exit
  setupProcessExitHandlers();

  return _tracerProvider;
}

/**
 * Force flush all pending spans immediately without shutting down.
 * Keeps the tracer running after flushing.
 */
export function forceFlushTracer(): Promise<void> {
  if (_tracerProvider !== null) {
    return _tracerProvider.forceFlush().then(() => {});
  }
  return Promise.resolve();
}

/**
 * Synchronous version of forceFlushTracer.
 * Starts the flush process but doesn't wait for completion.
 */
export function forceFlushTracerSync(): void {
  const flushPromise = forceFlushTracer();
  flushPromise
    .then(() => {})
    .catch((error: any) => {
      void error;
    });
}

/**
 * Shutdown tracing and flush any pending spans.
 * Flushes pending spans AND shuts down the tracer completely.
 */
export function shutdownTracing(): Promise<void> {
  if (_tracerProvider !== null && !_isShuttingDown) {
    _isShuttingDown = true;
    const shutdownPromise = _tracerProvider.shutdown();
    return shutdownPromise
      .then(() => {
        _tracerProvider = null;
        _isShuttingDown = false;
      })
      .catch((error: any) => {
        // Ensure cleanup happens even if shutdown fails
        _tracerProvider = null;
        _isShuttingDown = false;
        throw error;
      });
  }
  return Promise.resolve();
}

/**
 * Synchronous version of shutdownTracing that forces process exit.
 * Use this when you want simple sync-style shutdown without dealing with Promises.
 */
export function shutdownTracingSync(): void {
  // Start the async shutdown process
  const shutdownPromise = shutdownTracing();

  // For sync usage: schedule process exit after a reasonable delay
  // This ensures cleanup has time to complete while providing sync semantics
  setTimeout(() => {
    process.exit(0);
  }, 100); // Give enough time for BatchSpanProcessor cleanup

  // Also handle the promise to log completion
  shutdownPromise
    .then(() => {})
    .catch((error: any) => {
      void error;
    });
}

// Track if we've already set up process handlers to avoid duplicates
let _processHandlersSetup = false;

/**
 * Set up automatic cleanup on process exit signals
 */
function setupProcessExitHandlers(): void {
  // Only set up handlers once to avoid memory leaks in tests
  if (_processHandlersSetup || process.env.NODE_ENV === 'test') {
    return;
  }

  const cleanup = () => {
    if (_tracerProvider !== null) {
      _tracerProvider = null;
    }
  };

  // Handle various exit scenarios - only once
  process.once('exit', cleanup);
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  process.once('SIGUSR1', cleanup);
  process.once('SIGUSR2', cleanup);
  process.once('uncaughtException', cleanup);
  process.once('unhandledRejection', cleanup);

  _processHandlersSetup = true;
}

/**
 * Check if tracing has been initialized
 */
export function isInitialized(): boolean {
  return _tracerProvider !== null;
}

/**
 * Get the current configuration
 */
export function getConfig(): TraceRootConfigImpl | null {
  return _config;
}

/**
 * Get the tracer provider instance
 */
export function getTracerProvider(): NodeTracerProvider | null {
  return _tracerProvider;
}

/**
 * Decorator for tracing function execution.
 */
export function trace(options: TraceOptions = {}) {
  return function (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const traceOptions = new TraceOptionsImpl(options);
    descriptor.value = function (...args: any[]) {
      return _traceFunction(originalMethod, traceOptions, this, args);
    };
    return descriptor;
  };
}

/**
 * Function wrapper for tracing (alternative to decorator)
 */
export function traceFunction<T extends (...args: any[]) => any>(
  fn: T,
  options: TraceOptions = {}
): T {
  const traceOptions = new TraceOptionsImpl(options);
  return ((...args: any[]) => {
    return _traceFunction(fn, traceOptions, null, args);
  }) as T;
}

/**
 * Internal function for tracing execution
 */
function _traceFunction(fn: Function, options: TraceOptionsImpl, thisArg: any, args: any[]): any {
  // No-op if tracing is not initialized
  if (!isInitialized() || !_config) {
    return fn.apply(thisArg, args);
  }

  const tracer = otelTrace.getTracer('traceroot');
  const spanName = options.getSpanName(fn);

  return tracer.startActiveSpan(spanName, (span: Span) => {
    try {
      // Set AWS X-Ray annotations as individual attributes
      if (!_config!.local_mode && _config!._name) {
        span.setAttribute('hash', _config!._name);
      }
      span.setAttribute('service_name', _config!.service_name);
      span.setAttribute('service_environment', _config!.environment);
      // Add the missing attributes as span attributes
      span.setAttribute('service.github_owner', _config!.github_owner);
      span.setAttribute('service.github_repo_name', _config!.github_repo_name);
      span.setAttribute('service.version', _config!.github_commit_hash);
      span.setAttribute('telemetry_sdk_language', 'ts');

      // Add parameter attributes if requested
      if (options.traceParams) {
        const parameterValues = _paramsToDict(fn, options.traceParams, args);
        _storeDictInSpan(parameterValues, span, options.flattenAttributes);

        // Log parameters if console export is enabled
        if (_config!.enable_span_console_export) {
          console.log(`[ PARAMS] ${spanName}:`, parameterValues);
        }
      }

      // Execute the function
      let result: any;
      if (fn.constructor.name === 'AsyncFunction') {
        // Handle async function
        result = fn.apply(thisArg, args);
        if (result && typeof result.then === 'function') {
          return result
            .then((value: any) => {
              if (options.traceReturnValue) {
                _storeDictInSpan({ return: value }, span, options.flattenAttributes);

                // Log return value if console export is enabled
                if (_config!.enable_span_console_export) {
                  console.log(`[SPAN RETURN] ${spanName}:`, { return: value });
                }
              }

              // Add any pending log events before ending span
              if ((span as any)._pendingLogEvents) {
                for (const event of (span as any)._pendingLogEvents) {
                  span.addEvent(event.name, event.attributes, event.timestamp);
                }
              }

              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
              return value;
            })
            .catch((error: any) => {
              // Add any pending log events before ending span
              if ((span as any)._pendingLogEvents) {
                for (const event of (span as any)._pendingLogEvents) {
                  span.addEvent(event.name, event.attributes, event.timestamp);
                }
              }

              span.recordException(error);
              span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
              span.end();
              void error;
            });
        }
      } else {
        // Handle sync function
        result = fn.apply(thisArg, args);
      }

      if (options.traceReturnValue) {
        _storeDictInSpan({ return: result }, span, options.flattenAttributes);

        // Log return value if console export is enabled
        if (_config!.enable_span_console_export) {
          console.log(`[SPAN RETURN] ${spanName}:`, { return: result });
        }
      }

      // Add any pending log events before ending span
      if ((span as any)._pendingLogEvents) {
        for (const event of (span as any)._pendingLogEvents) {
          span.addEvent(event.name, event.attributes, event.timestamp);
        }
      }

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error: any) {
      // Add any pending log events before ending span
      if ((span as any)._pendingLogEvents) {
        for (const event of (span as any)._pendingLogEvents) {
          span.addEvent(event.name, event.attributes, event.timestamp);
        }
      }

      // Log span error
      if (_config!.enable_span_console_export) {
        console.log(`[SPAN ERROR] ${spanName}:`, error.message);
      }

      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.end();
      void error;
    }
  });
}

/**
 * Write custom attributes to the current active span
 */
export function writeAttributesToCurrentSpan(attributes: Record<string, any>): void {
  const span = otelTrace.getActiveSpan();
  if (span && span.isRecording()) {
    _storeDictInSpan(attributes, span, false);
  }
}

/**
 * Get trace headers for the current active span to propagate trace context in HTTP requests
 * Returns headers that can be used to maintain trace correlation across service boundaries
 */
export function getTraceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  const span = otelTrace.getActiveSpan();
  if (!span) {
    return headers;
  }

  const spanContext = span.spanContext();
  if (
    !spanContext ||
    !spanContext.traceId ||
    spanContext.traceId === '00000000000000000000000000000000'
  ) {
    return headers;
  }

  const traceId = spanContext.traceId;
  const spanId = spanContext.spanId;
  const traceFlags = spanContext.traceFlags || 0;

  // W3C Trace Context standard headers
  // Format: 00-{traceId}-{spanId}-{traceFlags}
  headers['traceparent'] = `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, '0')}`;

  // Add tracestate if available
  if (spanContext.traceState) {
    const traceStateString = spanContext.traceState.serialize();
    if (traceStateString) {
      headers['tracestate'] = traceStateString;
    }
  }

  // Custom headers for easier debugging and compatibility
  headers['x-trace-id'] = traceId;
  headers['x-span-id'] = spanId;

  // AWS X-Ray format trace ID for AWS services compatibility
  if (_config && !_config.local_mode) {
    headers['x-amzn-trace-id'] = `Root=1-${traceId.substring(0, 8)}-${traceId.substring(8)}`;
  }

  return headers;
}

/**
 * Convert function parameters to dictionary for tracing
 */
function _paramsToDict(
  func: Function,
  paramsToTrack: boolean | string[],
  args: any[]
): Record<string, any> {
  try {
    const result: Record<string, any> = {};

    // Get parameter names from function string (basic approach)
    const funcStr = func.toString();
    const match = funcStr.match(/\(([^)]*)\)/);
    if (!match) return result;

    const paramNames = match[1]
      .split(',')
      .map(param => param.trim().split(/[=\s]/)[0])
      .filter(name => name && name !== 'this');

    const shouldTrackKey = (key: string): boolean => {
      if (key === 'this') return false;
      if (typeof paramsToTrack === 'boolean') return paramsToTrack;
      return paramsToTrack.includes(key);
    };

    paramNames.forEach((name, index) => {
      if (shouldTrackKey(name) && index < args.length) {
        result[`params.${name}`] = args[index];
      }
    });

    return result;
  } catch {
    return {};
  }
}

/**
 * Store a dictionary in a span as attributes, optionally flattening it
 */
function _storeDictInSpan(data: Record<string, any>, span: Span, flatten: boolean = true): void {
  let processedData = data;

  if (flatten) {
    processedData = _flattenDict(data);
  }

  // Convert all values to strings and handle null/undefined
  const serializedData: Record<string, string> = {};
  for (const [key, value] of Object.entries(processedData)) {
    serializedData[key] = value !== null && value !== undefined ? String(value) : 'null';
  }

  span.setAttributes(serializedData);
}

/**
 * Flatten a dictionary, joining parent/child keys with separator
 */
function _flattenDict(data: Record<string, any>, sep: string = '_'): Record<string, any> {
  const result: Record<string, any> = {};

  function flatten(obj: any, prefix: string = '') {
    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}${sep}${key}` : key;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        flatten(value, newKey);
      } else {
        result[newKey] = value;
      }
    }
  }

  flatten(data);
  return result;
}

/**
 * Get the current active span ID for debugging purposes
 * Returns the span ID as a hex string, or null if no active span
 */
export function getSpanId(): string | null {
  const span = otelTrace.getActiveSpan();
  if (!span) {
    return null;
  }

  const spanContext = span.spanContext();
  if (!spanContext || !spanContext.spanId || spanContext.spanId === '0000000000000000') {
    return null;
  }

  return spanContext.spanId;
}

/**
 * Check if the current active span is recording
 * Returns true if there's an active span that is recording, false otherwise
 */
export function isRecording(): boolean {
  const span = otelTrace.getActiveSpan();
  if (!span) {
    return false;
  }

  return span.isRecording();
}

/**
 * Get detailed information about the current active span for debugging
 * Returns an object with trace ID, span ID, and recording status
 */
export function getActiveSpanInfo(): {
  traceId: string | null;
  spanId: string | null;
  isRecording: boolean;
  hasActiveSpan: boolean;
} {
  const span = otelTrace.getActiveSpan();

  if (!span) {
    return {
      traceId: null,
      spanId: null,
      isRecording: false,
      hasActiveSpan: false,
    };
  }

  const spanContext = span.spanContext();

  return {
    traceId: spanContext?.traceId || null,
    spanId: spanContext?.spanId || null,
    isRecording: span.isRecording(),
    hasActiveSpan: true,
  };
}
