import { trace as otelTrace, SpanStatusCode, Span } from '@opentelemetry/api';
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
  NoopSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { TraceRootConfig, TraceRootConfigImpl } from './config';
import { TraceOptions, AwsCredentials } from './types';
import { fetchAwsCredentialsSync } from './api/credential';
import {
  TELEMETRY_SDK_LANGUAGE,
  TELEMETRY_ATTRIBUTES,
  BATCH_SPAN_PROCESSOR_CONFIG,
  TRACER_NAME,
} from './constants';

// Global variables
let _tracerProvider: NodeTracerProvider | null = null;
let _config: TraceRootConfigImpl | null = null;
let _isShuttingDown: boolean = false;

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

/**
 * Initialize TraceRoot tracing and logging (synchronous).
 *
 * This is the main entry point for setting up tracing and logging.
 * This will be called at least once at the start where TraceRoot is auto-initialized or manually initialized.
 */
export function _initializeTracing(kwargs: Partial<TraceRootConfig> = {}): NodeTracerProvider {
  // Check if already initialized
  if (_tracerProvider !== null) {
    return _tracerProvider;
  }

  // Prepare config first
  const config = _prepareConfig(kwargs);
  _config = config;

  // Check if there's already a global tracer provider registered
  const existingProvider = _detectExistingProvider();

  if (existingProvider) {
    return _enhanceExistingProvider(existingProvider, config);
  } else {
    return _createNewProvider(config);
  }
}

/**
 * Force flush all pending spans immediately without shutting down.
 * Keeps the tracer running after flushing.
 *
 * This function is fire-and-forget - it starts the flush process but
 * catches any rejections internally to prevent unhandled promise rejections.
 * Use forceFlushTracerAsync() if you need to handle flush errors.
 */
export function forceFlushTracer(): Promise<void> {
  if (_tracerProvider !== null) {
    console.log('[TraceRoot] Flushing tracer');
    // Return a promise that never rejects to prevent unhandled rejections
    return _tracerProvider
      .forceFlush()
      .then(() => {})
      .catch((error: any) => {
        // Silently ignore non-critical flush failures
        console.error('[TraceRoot] Error flushing tracer', error);
      });
  }
  return Promise.resolve();
}

/**
 * Async version of forceFlushTracer that surfaces errors to callers.
 * Use this when you want to handle flush failures explicitly.
 */
export function forceFlushTracerAsync(): Promise<void> {
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
export function shutdownTracer(): Promise<void> {
  if (_tracerProvider !== null && !_isShuttingDown) {
    _isShuttingDown = true;
    const shutdownPromise = _tracerProvider.shutdown();
    return shutdownPromise
      .then(() => {
        _tracerProvider = null;
        _config = null;
        _isShuttingDown = false;
      })
      .catch((error: any) => {
        // Ensure cleanup happens even if shutdown fails
        console.error('[TraceRoot] Error during tracer shutdown:', error.message);
        _tracerProvider = null;
        _config = null;
        _isShuttingDown = false;
        throw error;
      });
  }
  return Promise.resolve();
}

/**
 * Shutdown tracing and flush any pending spans.
 * Flushes pending spans AND shuts down the tracer completely.
 *
 * @deprecated Use shutdownTracer() instead. This function will be removed in a future version.
 */
export function shutdownTracing(): Promise<void> {
  return shutdownTracer();
}

/**
 * Synchronous version of shutdownTracer that forces process exit.
 * Use this when you want simple sync-style shutdown without dealing with Promises.
 */
export function shutdownTracerSync(): void {
  // Start the async shutdown process
  const shutdownPromise = shutdownTracer();

  // For sync usage: schedule process exit after a reasonable delay
  // This ensures cleanup has time to complete while providing sync semantics
  setTimeout(() => {
    process.exit(0);
  }, 500); // Give enough time for BatchSpanProcessor cleanup

  // Also handle the promise to log completion
  shutdownPromise
    .then(() => {})
    .catch((error: any) => {
      void error;
    });
}

/**
 * Synchronous version of shutdownTracing that forces process exit.
 * Use this when you want simple sync-style shutdown without dealing with Promises.
 *
 * @deprecated Use shutdownTracerSync() instead. This function will be removed in a future version.
 */
export function shutdownTracingSync(): void {
  return shutdownTracerSync();
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
      _config = null;
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
 * Prepare and validate TraceRoot configuration
 */
function _prepareConfig(kwargs: Partial<TraceRootConfig> = {}): TraceRootConfigImpl {
  // Merge file config with kwargs (kwargs take precedence)
  let configParams: Partial<TraceRootConfig> = kwargs;

  if (Object.keys(configParams).length === 0) {
    throw new Error('No configuration provided for TraceRoot initialization');
  }

  // Fill in missing fields with some default values if not provided
  if (!configParams.service_name) {
    configParams.service_name = 'default-service';
  }
  if (!configParams.github_owner) {
    configParams.github_owner = 'unknown';
  }
  if (!configParams.github_repo_name) {
    configParams.github_repo_name = 'unknown';
  }
  if (!configParams.github_commit_hash) {
    configParams.github_commit_hash = 'unknown';
  }

  const config = new TraceRootConfigImpl(configParams as TraceRootConfig);

  // If not in local mode and cloud export is enabled, fetch AWS credentials
  if (!config.local_mode && config.enable_span_cloud_export) {
    console.log(
      `[TraceRoot DEBUG] Fetching credentials for token: ${config.token?.substring(0, 20)}...`
    );
    const credentials: AwsCredentials | null = fetchAwsCredentialsSync(config);
    console.log(`[TraceRoot DEBUG] Credentials result:`, credentials ? 'success' : 'failed');
    if (credentials) {
      console.log(`[TraceRoot DEBUG] Credentials object:`, JSON.stringify(credentials, null, 2));
      console.log(`[TraceRoot DEBUG] Credential endpoint: ${credentials.otlp_endpoint}`);

      // Update config with fetched credentials
      if (credentials.hash) {
        config._name = credentials.hash;
      }

      if (credentials.otlp_endpoint) {
        config.otlp_endpoint = credentials.otlp_endpoint;
      } else {
        console.log(
          `[TraceRoot DEBUG] No endpoint in credentials, keeping default: ${config.otlp_endpoint}`
        );
      }

      // Store credentials in config for logger to use later (only if cloud logging is enabled)
      if (config.enable_log_cloud_export) {
        (config as any)._awsCredentials = credentials;
      }
    }
  } else if (!config.enable_span_cloud_export) {
    // If span cloud export is disabled, also disable log cloud export
    config.enable_log_cloud_export = false;
  }

  return config;
}

/**
 * Detect if there's an existing OpenTelemetry provider we can enhance
 */
function _detectExistingProvider(): NodeTracerProvider | null {
  const existingProvider = otelTrace.getTracerProvider();
  const providerType = existingProvider?.constructor?.name;

  console.log(`[TraceRoot DEBUG] Checking for existing provider...`);
  console.log(`[TraceRoot DEBUG] existingProvider:`, !!existingProvider);
  console.log(`[TraceRoot DEBUG] providerType:`, providerType);
  console.log(`[TraceRoot DEBUG] provider constructor:`, existingProvider?.constructor);

  // Check if we have a real provider (including ProxyTracerProvider which wraps NodeTracerProvider)
  if (
    existingProvider &&
    providerType &&
    providerType !== 'NoopTracerProvider' &&
    (providerType === 'NodeTracerProvider' ||
      providerType === 'ProxyTracerProvider' ||
      providerType.includes('TracerProvider'))
  ) {
    console.log(
      `[TraceRoot] Detected existing OpenTelemetry provider (${providerType}), adding TraceRoot processors to send traces to both destinations`
    );
    return existingProvider as NodeTracerProvider;
  }

  console.log(`[TraceRoot DEBUG] No compatible provider detected, creating new one`);
  return null;
}

/**
 * Enhance an existing provider by adding TraceRoot processors
 */
function _enhanceExistingProvider(
  existingProvider: NodeTracerProvider,
  config: TraceRootConfigImpl
): NodeTracerProvider {
  console.log(
    `[TraceRoot DEBUG] Enhancing existing provider type: ${existingProvider.constructor.name}`
  );

  // Create TraceRoot's processors
  const traceRootProcessors = _createTraceRootProcessors(config);
  console.log(`[TraceRoot DEBUG] Created ${traceRootProcessors.length} TraceRoot processors`);

  if (existingProvider.constructor.name === 'ProxyTracerProvider') {
    // For ProxyTracerProvider, we need to wait for it to have a delegate
    // or find another way to access the underlying provider
    console.log(`[TraceRoot DEBUG] Attempting to access ProxyTracerProvider delegate...`);

    // Log all properties to see what's available
    console.log(
      `[TraceRoot DEBUG] ProxyTracerProvider properties:`,
      Object.getOwnPropertyNames(existingProvider)
    );
    console.log(
      `[TraceRoot DEBUG] ProxyTracerProvider methods:`,
      Object.getOwnPropertyNames(Object.getPrototypeOf(existingProvider))
    );

    // Use ProxyTracerProvider's getDelegate method
    let actualProvider: NodeTracerProvider | null = null;

    if (typeof (existingProvider as any).getDelegate === 'function') {
      console.log(`[TraceRoot DEBUG] Using ProxyTracerProvider.getDelegate() method`);
      const delegate = (existingProvider as any).getDelegate();
      console.log(
        `[TraceRoot DEBUG] getDelegate() returned:`,
        delegate ? delegate.constructor?.name : 'null'
      );

      // Check if delegate is a real provider, not NoopTracerProvider
      if (
        delegate &&
        delegate.constructor?.name !== 'NoopTracerProvider' &&
        typeof delegate.addSpanProcessor === 'function'
      ) {
        actualProvider = delegate;
        console.log(`[TraceRoot DEBUG] Using real delegate provider`);
      } else {
        console.log(
          `[TraceRoot DEBUG] Delegate is NoopTracerProvider or invalid, will create TraceRoot-only provider`
        );
      }
    }

    // If getDelegate returns null, try direct property access as fallback
    if (!actualProvider) {
      console.log(`[TraceRoot DEBUG] getDelegate() returned null, trying property access`);
      const possibleDelegates = [
        (existingProvider as any)._delegate,
        (existingProvider as any).delegate,
        (existingProvider as any)._provider,
        (existingProvider as any).provider,
      ];

      for (let i = 0; i < possibleDelegates.length; i++) {
        const delegate = possibleDelegates[i];
        console.log(
          `[TraceRoot DEBUG] Checking delegate ${i}:`,
          delegate ? delegate.constructor?.name : 'undefined'
        );
        if (delegate && typeof delegate.addSpanProcessor === 'function') {
          actualProvider = delegate as NodeTracerProvider;
          console.log(`[TraceRoot DEBUG] Found delegate with addSpanProcessor method`);
          break;
        }
      }
    }

    if (actualProvider) {
      // Check existing processors before adding TraceRoot ones
      const existingProcessors = (actualProvider as any)._registeredSpanProcessors || [];
      console.log(
        `[TraceRoot DEBUG] Delegate has ${existingProcessors.length} existing processors before enhancement`
      );

      // Add TraceRoot processors to the real provider
      for (const processor of traceRootProcessors) {
        actualProvider.addSpanProcessor(processor);
        console.log(
          `[TraceRoot DEBUG] Added TraceRoot processor to existing provider via delegate`
        );
      }

      // Check processors after adding TraceRoot ones
      const finalProcessors = (actualProvider as any)._registeredSpanProcessors || [];
      console.log(
        `[TraceRoot DEBUG] Delegate now has ${finalProcessors.length} total processors after enhancement`
      );

      // Log processor types for debugging
      finalProcessors.forEach((proc: any, index: number) => {
        const exporterType = proc._exporter?.constructor?.name || 'unknown';
        const exporterUrl = proc._exporter?.url || 'unknown';
        const exporterHeaders = Object.keys(proc._exporter?.headers || {});
        console.log(
          `[TraceRoot DEBUG] Processor ${index}: ${proc.constructor?.name} with ${exporterType} exporter`
        );
        console.log(`[TraceRoot DEBUG]   URL: ${exporterUrl}`);
        console.log(`[TraceRoot DEBUG]   Headers: [${exporterHeaders.join(', ')}]`);
      });

      _tracerProvider = actualProvider;
    } else {
      console.log(`[TraceRoot DEBUG] Could not access delegate, using TraceRoot-only provider`);
      // Fallback: create TraceRoot-only provider without registering globally
      _tracerProvider = new NodeTracerProvider({
        resource: Resource.default().merge(
          new Resource({
            [ATTR_SERVICE_NAME]: config.service_name || 'traceroot-service',
          })
        ),
        spanProcessors: traceRootProcessors,
      });
    }
  } else {
    // For real NodeTracerProvider, add processors directly
    console.log(`[TraceRoot DEBUG] Adding processors to real NodeTracerProvider`);
    for (const processor of traceRootProcessors) {
      existingProvider.addSpanProcessor(processor);
      console.log(`[TraceRoot DEBUG] Added TraceRoot processor to existing provider`);
    }
    _tracerProvider = existingProvider;
  }

  setupProcessExitHandlers();
  console.log(
    '[TraceRoot] Tracer initialized (enhanced existing provider with TraceRoot processors)'
  );
  return _tracerProvider;
}

/**
 * Create a new NodeTracerProvider with TraceRoot configuration
 */
function _createNewProvider(config: TraceRootConfigImpl): NodeTracerProvider {
  // If both span exports are disabled, create minimal no-op tracer
  if (!config.enable_span_cloud_export && !config.enable_span_console_export) {
    _tracerProvider = new NodeTracerProvider({
      resource: Resource.default(),
      spanProcessors: [new NoopSpanProcessor()],
    });

    // Register the no-op tracer provider globally
    _tracerProvider.register();

    setupProcessExitHandlers();
    return _tracerProvider;
  }

  // Create resource with service information using new semantic conventions
  const resource = Resource.default().merge(
    new Resource({
      [ATTR_SERVICE_NAME]: config.service_name,
      [ATTR_SERVICE_VERSION]: config.github_commit_hash,
      'service.github_owner': config.github_owner,
      'service.github_repo_name': config.github_repo_name,
      'service.environment': config.environment,
      [TELEMETRY_ATTRIBUTES.SDK_LANGUAGE]: TELEMETRY_SDK_LANGUAGE,
    })
  );

  // Create span processors using the helper function
  const spanProcessors = _createTraceRootProcessors(config);

  // If no processors created (all exports disabled), add NoopSpanProcessor
  if (spanProcessors.length === 0) {
    spanProcessors.push(new NoopSpanProcessor());
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

  console.log('[TraceRoot] Tracer initialized');
  return _tracerProvider;
}

/**
 * Helper function to create TraceRoot span processors
 */
function _createTraceRootProcessors(config: TraceRootConfigImpl): any[] {
  const spanProcessors = [];

  // Create main span processor based on cloud export configuration
  if (config.enable_span_cloud_export) {
    console.log(`[TraceRoot] Creating OTLP exporter for: ${config.otlp_endpoint}`);

    // Create trace exporter for cloud export
    const traceExporter = new OTLPTraceExporter({
      url: config.otlp_endpoint,
    });

    // Create span processor
    const spanProcessor = config.local_mode
      ? new SimpleSpanProcessor(traceExporter)
      : new BatchSpanProcessor(traceExporter, {
          maxExportBatchSize: BATCH_SPAN_PROCESSOR_CONFIG.MAX_EXPORT_BATCH_SIZE,
          exportTimeoutMillis: BATCH_SPAN_PROCESSOR_CONFIG.EXPORT_TIMEOUT_MILLIS,
          scheduledDelayMillis: BATCH_SPAN_PROCESSOR_CONFIG.SCHEDULED_DELAY_MILLIS,
          maxQueueSize: BATCH_SPAN_PROCESSOR_CONFIG.MAX_QUEUE_SIZE,
        });

    spanProcessors.push(spanProcessor);
    console.log(`[TraceRoot] Added OTLP span processor to export queue`);
  } else {
    console.log(`[TraceRoot] Cloud export disabled - no OTLP processor created`);
  }

  // If console export is enabled, add console span processor
  if (config.enable_span_console_export) {
    const consoleExporter = new ConsoleSpanExporter();
    const consoleProcessor = config.local_mode
      ? new SimpleSpanProcessor(consoleExporter)
      : new BatchSpanProcessor(consoleExporter, {
          maxExportBatchSize: BATCH_SPAN_PROCESSOR_CONFIG.MAX_EXPORT_BATCH_SIZE,
          exportTimeoutMillis: BATCH_SPAN_PROCESSOR_CONFIG.EXPORT_TIMEOUT_MILLIS,
          scheduledDelayMillis: BATCH_SPAN_PROCESSOR_CONFIG.SCHEDULED_DELAY_MILLIS,
          maxQueueSize: BATCH_SPAN_PROCESSOR_CONFIG.MAX_QUEUE_SIZE,
        });
    spanProcessors.push(consoleProcessor);
  }

  return spanProcessors;
}

/**
 * Helper function to add pending log events to span
 */
function _addPendingLogEvents(span: Span): void {
  if ((span as any)._pendingLogEvents) {
    for (const event of (span as any)._pendingLogEvents) {
      span.addEvent(event.name, event.attributes, event.timestamp);
    }
  }
}

/**
 * Helper function to finalize span with success status
 */
function _finalizeSpanSuccess(span: Span, returnValue: any, options: TraceOptionsImpl): any {
  if (options.traceReturnValue) {
    _storeDictInSpan({ return: returnValue }, span, options.flattenAttributes);
  }
  _addPendingLogEvents(span);
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
  return returnValue;
}

/**
 * Helper function to finalize span with error status
 */
function _finalizeSpanError(span: Span, error: any): void {
  _addPendingLogEvents(span);
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  span.end();
}

/**
 * Internal function for tracing execution
 */
function _traceFunction(fn: Function, options: TraceOptionsImpl, thisArg: any, args: any[]): any {
  // No-op if tracing is not initialized
  if (!isInitialized() || !_config) {
    return fn.apply(thisArg, args);
  }

  const tracer = otelTrace.getTracer(TRACER_NAME);
  const spanName = options.getSpanName(fn);

  return tracer.startActiveSpan(spanName, (span: Span) => {
    try {
      // Set AWS X-Ray annotations as individual attributes
      if (!_config!.local_mode && _config!._name) {
        span.setAttribute('hash', _config!._name);
      }
      span.setAttribute('service_name', _config!.service_name);
      span.setAttribute('service_environment', _config!.environment);
      span.setAttribute(TELEMETRY_ATTRIBUTES.SDK_LANGUAGE_UNDERSCORE, TELEMETRY_SDK_LANGUAGE);

      // Add parameter attributes if requested
      if (options.traceParams) {
        const parameterValues = _paramsToDict(fn, options.traceParams, args);
        _storeDictInSpan(parameterValues, span, options.flattenAttributes);
      }

      // Execute the function
      let result: any;
      if (fn.constructor.name === 'AsyncFunction') {
        // Handle async function
        result = fn.apply(thisArg, args);
        if (result && typeof result.then === 'function') {
          return result
            .then((value: any) => {
              return _finalizeSpanSuccess(span, value, options);
            })
            .catch((error: any) => {
              _finalizeSpanError(span, error);
              throw error;
            });
        }
      } else {
        // Handle sync function
        result = fn.apply(thisArg, args);
      }

      return _finalizeSpanSuccess(span, result, options);
    } catch (error: any) {
      _finalizeSpanError(span, error);
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
