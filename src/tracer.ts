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
import { findTracerootConfig } from './utils/config';
import axios from 'axios';

// Global state
let _tracerProvider: NodeTracerProvider | null = null;
let _config: TraceRootConfigImpl | null = null;

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
  otlp_endpoint: string;
}

/**
 * Fetch AWS credentials from TraceRoot API
 */
async function fetchAwsCredentials(config: TraceRootConfigImpl): Promise<AwsCredentials | null> {
  try {
    const response = await axios.get('https://api.test.traceroot.ai/v1/verify/credentials', {
      params: { token: config.token },
      headers: { 'Content-Type': 'application/json' },
    });
    return response.data;
  } catch (error: any) {
    console.log(`[TraceRoot] Failed to fetch AWS credentials: ${error.message}`);
    return null;
  }
}

/**
 * Initialize TraceRoot tracing and logging.
 *
 * This is the main entry point for setting up tracing and logging.
 * Call this once at the start of your application.
 */
export async function _initializeTracing(
  kwargs: Partial<TraceRootConfig> = {}
): Promise<NodeTracerProvider> {
  // Check if already initialized
  if (_tracerProvider !== null) {
    return _tracerProvider;
  }

  // Load configuration from YAML file first
  const yamlConfig = findTracerootConfig();

  // Merge YAML config with kwargs (kwargs take precedence)
  let configParams: Partial<TraceRootConfig>;
  if (yamlConfig) {
    configParams = { ...yamlConfig, ...kwargs };
  } else {
    configParams = kwargs;
  }

  if (Object.keys(configParams).length === 0) {
    throw new Error('No configuration provided for TraceRoot initialization');
  }

  // Validate required fields
  if (
    !configParams.service_name ||
    !configParams.github_owner ||
    !configParams.github_repo_name ||
    !configParams.github_commit_hash
  ) {
    throw new Error(
      'Missing required configuration fields: service_name, github_owner, github_repo_name, github_commit_hash'
    );
  }

  const config = new TraceRootConfigImpl(configParams as TraceRootConfig);

  // If not in local mode, fetch AWS credentials and update config before creating tracer
  if (!config.local_mode) {
    console.log(`[TraceRoot] Fetching AWS credentials...`);
    const credentials = await fetchAwsCredentials(config);
    if (credentials) {
      console.log(`[TraceRoot] AWS credentials fetched successfully`);
      // Update config with fetched credentials
      config._name = credentials.hash;
      config.otlp_endpoint = credentials.otlp_endpoint;

      // Store credentials in config for logger to use later
      (config as any)._awsCredentials = credentials;
    } else {
      console.log(`[TraceRoot] Failed to fetch AWS credentials, using default configuration`);
    }
  }

  _config = config;

  console.log(`[TraceRoot] Initializing with OTLP endpoint: ${config.otlp_endpoint}`);
  console.log(`[TraceRoot] Console export enabled: ${config.enable_span_console_export}`);
  console.log(`[TraceRoot] Local mode: ${config.local_mode}`);

  // Test OTLP endpoint connectivity
  if (config.local_mode) {
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
    })
  );

  // Create trace exporter with debugging - now using the correct endpoint
  const traceExporter = new OTLPTraceExporter({
    url: config.otlp_endpoint,
  });

  console.log('traceExporter:', traceExporter);

  // Add debugging to the exporter
  const originalExport = traceExporter.export.bind(traceExporter);
  traceExporter.export = function (spans: any, resultCallback: any) {
    console.log(
      `[DEBUG] Exporting ${spans.length} spans to OTLP:`,
      spans.map((s: any) => ({
        name: s.name,
        traceId: s.spanContext().traceId,
        spanId: s.spanContext().spanId,
        eventCount: s.events ? s.events.length : 0,
      }))
    );
    return originalExport(spans, (result: any) => {
      console.log(`[DEBUG] OTLP export result:`, result);
      resultCallback(result);
    });
  };

  // Create and configure the tracer provider
  _tracerProvider = new NodeTracerProvider({
    resource: resource,
  });

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

  // Add the span processor to the tracer provider
  _tracerProvider.addSpanProcessor(spanProcessor);

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
    _tracerProvider.addSpanProcessor(consoleProcessor);
    console.log(`[TraceRoot] Console span export enabled - spans will be logged`);
  }

  // Register the tracer provider globally
  _tracerProvider.register();
  console.log(`[TraceRoot] TracerProvider initialized successfully`);

  return _tracerProvider;
}

/**
 * Shutdown tracing and flush any pending spans.
 */
export function shutdownTracing(): Promise<void> {
  if (_tracerProvider !== null) {
    console.log('[TraceRoot] Shutting down and flushing traces...');
    return _tracerProvider.shutdown().then(() => {
      console.log('[TraceRoot] Traces flushed successfully');
      _tracerProvider = null;
    });
  }
  return Promise.resolve();
}

/**
 * Force flush any pending spans immediately.
 */
export function forceFlush(): Promise<void> {
  if (_tracerProvider !== null) {
    console.log('[TraceRoot] Force flushing traces...');
    return _tracerProvider.forceFlush().then(() => {
      console.log('[TraceRoot] Traces force flushed successfully');
    });
  }
  return Promise.resolve();
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
      // Log span creation if console export is enabled
      if (_config!.enable_span_console_export) {
        const spanContext = span.spanContext();
        console.log(
          `[SPAN START] ${spanName} - Trace: ${spanContext.traceId}, Span: ${spanContext.spanId}`
        );
      }

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

      // Add parameter attributes if requested
      if (options.traceParams) {
        const parameterValues = _paramsToDict(fn, options.traceParams, args);
        _storeDictInSpan(parameterValues, span, options.flattenAttributes);

        // Log parameters if console export is enabled
        if (_config!.enable_span_console_export) {
          console.log(`[SPAN PARAMS] ${spanName}:`, parameterValues);
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

              // Log span completion
              if (_config!.enable_span_console_export) {
                console.log(`[SPAN END] ${spanName} - SUCCESS`);
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

              // Log span error
              if (_config!.enable_span_console_export) {
                console.log(`[SPAN ERROR] ${spanName}:`, error.message);
              }

              span.recordException(error);
              span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
              span.end();
              throw error;
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

      // Log span completion
      if (_config!.enable_span_console_export) {
        console.log(`[SPAN END] ${spanName} - SUCCESS`);
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
      throw error;
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
