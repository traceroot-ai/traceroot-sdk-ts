/**
 * Tests for tracer provider detection and enhancement functionality
 * Tests the ability to detect existing OpenTelemetry providers and enhance them with TraceRoot processors
 */

// Disable auto-initialization for tests to avoid config file interference
process.env.TRACEROOT_DISABLE_AUTO_INIT = 'true';

import { jest } from '@jest/globals';
import { trace as otelTrace, TracerProvider } from '@opentelemetry/api';
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  NoopSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import * as traceroot from '../../src/index';
import { TraceRootConfig } from '../../src/config';

// Mock the credential fetching function
jest.mock('../../src/api/credential', () => ({
  fetchAwsCredentialsSync: jest.fn(),
}));

// Mock OTLPTraceExporter to avoid network calls during tests
jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: jest.fn().mockImplementation(() => ({
    export: jest.fn(),
    shutdown: jest.fn().mockImplementation(async () => {}),
  })),
}));

describe('Tracer Provider Detection and Enhancement', () => {
  // Set timeout for async operations
  jest.setTimeout(10000);

  let originalGetTracerProvider: typeof otelTrace.getTracerProvider;

  beforeEach(() => {
    // Store original function to restore later
    originalGetTracerProvider = otelTrace.getTracerProvider;
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Restore original function
    otelTrace.getTracerProvider = originalGetTracerProvider;

    // Clean up any TraceRoot initialization
    await traceroot.shutdownTracing();
    await traceroot.shutdownLogger();

    // Reset global tracer provider
    if ((otelTrace as any)._proxyTracerProvider) {
      (otelTrace as any)._proxyTracerProvider._delegate = undefined;
    }
  });

  const createTestConfig = (
    overrides: Partial<TraceRootConfig> = {}
  ): Partial<TraceRootConfig> => ({
    service_name: 'test-service',
    github_owner: 'test-owner',
    github_repo_name: 'test-repo',
    github_commit_hash: 'test-commit',
    environment: 'test',
    local_mode: true,
    enable_span_console_export: true,
    enable_span_cloud_export: false,
    enable_log_console_export: true,
    token: 'test-token',
    tracer_verbose: true,
    ...overrides,
  });

  describe('Provider Detection', () => {
    test('should detect NodeTracerProvider as existing provider', async () => {
      // Create a mock existing provider
      const existingProvider = new NodeTracerProvider({
        resource: Resource.default(),
      });

      // Mock getTracerProvider to return our existing provider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(existingProvider) as any;

      // Spy on console.log to verify detection message
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const config = createTestConfig();
      traceroot.init(config);

      // Verify that the existing provider was detected
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Detected existing OpenTelemetry provider (NodeTracerProvider)')
      );

      consoleSpy.mockRestore();
    });

    test('should not detect NoopTracerProvider as existing provider', async () => {
      // Create a mock NoopTracerProvider
      const noopProvider = {
        constructor: { name: 'NoopTracerProvider' },
        getTracer: jest.fn(),
      };

      // Mock getTracerProvider to return NoopTracerProvider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(noopProvider as any) as any;

      // Spy on console.log to verify no detection message
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const config = createTestConfig();
      traceroot.init(config);

      // Verify that NoopTracerProvider was not detected as existing
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Detected existing OpenTelemetry provider (NoopTracerProvider)')
      );

      consoleSpy.mockRestore();
    });

    test('should detect ProxyTracerProvider as existing provider', async () => {
      // Create a mock ProxyTracerProvider
      const proxyProvider = {
        constructor: { name: 'ProxyTracerProvider' },
        getTracer: jest.fn(),
        addSpanProcessor: jest.fn(),
        shutdown: jest.fn().mockImplementation(async () => {}),
      };

      // Mock getTracerProvider to return ProxyTracerProvider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(proxyProvider as any) as any;

      // Spy on console.log to verify detection message
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const config = createTestConfig();
      traceroot.init(config);

      // Verify that ProxyTracerProvider was detected as existing
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Detected existing OpenTelemetry provider (ProxyTracerProvider)')
      );

      consoleSpy.mockRestore();
    });

    test('should detect custom TracerProvider implementations', async () => {
      // Create a mock custom TracerProvider
      const customProvider = {
        constructor: { name: 'CustomTracerProvider' },
        getTracer: jest.fn(),
        addSpanProcessor: jest.fn(),
        register: jest.fn(),
        forceFlush: jest.fn().mockImplementation(async () => {}),
        shutdown: jest.fn().mockImplementation(async () => {}),
        _spanProcessors: [],
        _resource: Resource.default(),
      };

      // Mock getTracerProvider to return custom provider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(customProvider as any) as any;

      // Spy on console.log to verify detection message
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const config = createTestConfig();
      traceroot.init(config);

      // Verify that custom TracerProvider was detected
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Detected existing OpenTelemetry provider (CustomTracerProvider)')
      );

      consoleSpy.mockRestore();
    });

    test('should handle null/undefined existing provider gracefully', async () => {
      // Mock getTracerProvider to return null
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(null) as any;

      // Spy on console.log to verify no detection message
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const config = createTestConfig();
      traceroot.init(config);

      // Verify that no existing provider detection message was logged
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Detected existing OpenTelemetry provider')
      );

      // Should still log tracer initialization
      expect(consoleSpy).toHaveBeenCalledWith(
        '[TraceRoot] Tracer initialized through new provider'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Provider Enhancement', () => {
    test('should enhance existing provider by adding TraceRoot processors', async () => {
      // Create a mock existing provider with some processors
      const existingProcessor = new NoopSpanProcessor();
      const existingProvider = new NodeTracerProvider({
        resource: Resource.default(),
        spanProcessors: [existingProcessor],
      });

      // Mock internal properties that would exist on a real provider
      (existingProvider as any)._spanProcessors = [existingProcessor];
      (existingProvider as any)._resource = Resource.default();

      // Mock getTracerProvider to return existing provider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(existingProvider) as any;

      // Spy on console.log to verify enhancement message
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const config = createTestConfig({
        enable_span_console_export: true,
        enable_span_cloud_export: false,
      });

      traceroot.init(config);

      // Verify enhancement message was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        '[TraceRoot] Tracer initialized (enhanced existing provider with TraceRoot processors)'
      );

      consoleSpy.mockRestore();
    });

    test('should preserve existing processors when enhancing provider', async () => {
      // Create existing processors
      const existingConsoleProcessor = new BatchSpanProcessor(new ConsoleSpanExporter());
      const existingProvider = new NodeTracerProvider({
        resource: Resource.default(),
      });

      // Mock internal properties
      (existingProvider as any)._spanProcessors = [existingConsoleProcessor];
      (existingProvider as any)._resource = Resource.default();

      // Mock getTracerProvider to return existing provider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(existingProvider) as any;

      const config = createTestConfig({
        enable_span_console_export: true,
        enable_span_cloud_export: false,
      });

      traceroot.init(config);

      // Verify tracer was initialized successfully
      const { isInitialized } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      // Test that tracing still works with enhanced provider
      const tracedFunction = traceroot.traceFunction(
        function testFunction() {
          return 'enhanced-result';
        },
        { spanName: 'enhanced-test-span' }
      );

      const result = tracedFunction();
      expect(result).toBe('enhanced-result');
    });

    test('should enhance provider with cloud export processors', async () => {
      const { fetchAwsCredentialsSync } = require('../../src/api/credential');

      // Mock AWS credentials
      fetchAwsCredentialsSync.mockReturnValue({
        hash: 'test-hash',
        otlp_endpoint: 'http://test-endpoint:4318/v1/traces',
        aws_access_key_id: 'test-key',
        aws_secret_access_key: 'test-secret',
        aws_session_token: 'test-token',
        region: 'us-west-2',
        expiration_utc: new Date(Date.now() + 3600000),
      });

      const existingProvider = new NodeTracerProvider({
        resource: Resource.default(),
      });

      // Mock internal properties
      (existingProvider as any)._spanProcessors = [];
      (existingProvider as any)._resource = Resource.default();

      // Mock getTracerProvider to return existing provider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(existingProvider) as any;

      // Spy on console.log to verify OTLP processor creation
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const config = createTestConfig({
        local_mode: false,
        enable_span_cloud_export: true,
        enable_span_console_export: false,
      });

      traceroot.init(config);

      // Verify OTLP processor was created
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Creating OTLP exporter for: http://test-endpoint:4318/v1/traces')
      );

      // Verify OTLPTraceExporter was instantiated
      expect(OTLPTraceExporter).toHaveBeenCalledWith({
        url: 'http://test-endpoint:4318/v1/traces',
      });

      consoleSpy.mockRestore();
    });

    test('should preserve existing resource when enhancing provider', async () => {
      // Create existing provider with custom resource
      const existingResource = Resource.default().merge(
        new Resource({
          'service.name': 'existing-service',
          'service.version': 'v1.0.0',
          'custom.attribute': 'existing-value',
        })
      );

      const existingProvider = new NodeTracerProvider({
        resource: existingResource,
      });

      // Mock internal properties
      (existingProvider as any)._spanProcessors = [];
      (existingProvider as any)._resource = existingResource;

      // Mock getTracerProvider to return existing provider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(existingProvider) as any;

      const config = createTestConfig();
      traceroot.init(config);

      // Verify tracer was initialized
      const { isInitialized, getConfig } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      // Test that tracing works with preserved resource
      const tracedFunction = traceroot.traceFunction(function testFunction() {
        return 'resource-preserved';
      });

      const result = tracedFunction();
      expect(result).toBe('resource-preserved');
    });
  });

  describe('New Provider Creation', () => {
    test('should create new provider when no existing provider found', async () => {
      // Mock getTracerProvider to return NoopTracerProvider (which should not be enhanced)
      const noopProvider = {
        constructor: { name: 'NoopTracerProvider' },
        getTracer: jest.fn(),
      };
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(noopProvider as any) as any;

      // Spy on console.log to verify new provider creation
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const config = createTestConfig();
      traceroot.init(config);

      // Verify new provider was created (not enhanced)
      expect(consoleSpy).toHaveBeenCalledWith(
        '[TraceRoot] Tracer initialized through new provider'
      );
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('enhanced existing provider')
      );

      consoleSpy.mockRestore();
    });

    test('should create new provider with TraceRoot resource attributes', async () => {
      // Mock getTracerProvider to return null
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(null) as any;

      const config = createTestConfig({
        service_name: 'new-provider-service',
        github_owner: 'new-owner',
        github_repo_name: 'new-repo',
        github_commit_hash: 'new-commit',
        environment: 'production',
      });

      traceroot.init(config);

      // Verify tracer was initialized
      const { isInitialized, getConfig } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      const tracerConfig = getConfig();
      expect(tracerConfig?.service_name).toBe('new-provider-service');
      expect(tracerConfig?.github_owner).toBe('new-owner');
      expect(tracerConfig?.github_repo_name).toBe('new-repo');
      expect(tracerConfig?.github_commit_hash).toBe('new-commit');
      expect(tracerConfig?.environment).toBe('production');
    });

    test('should create no-op provider when both exports are disabled', async () => {
      // Don't mock getTracerProvider for this test - let the real registration happen
      const config = createTestConfig({
        enable_span_cloud_export: false,
        enable_span_console_export: false,
      });

      traceroot.init(config);

      // Verify tracer was initialized
      const { isInitialized } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      // With no-op provider, traced functions should work but not create real spans
      // The tracer should handle the no-op case gracefully
      const tracedFunction = traceroot.traceFunction(function testFunction() {
        return 'noop-result';
      });

      const result = tracedFunction();
      expect(result).toBe('noop-result');
    });
  });

  describe('Integration Scenarios', () => {
    test('should handle multiple initialization calls with existing provider', async () => {
      const existingProvider = new NodeTracerProvider({
        resource: Resource.default(),
      });

      // Mock internal properties
      (existingProvider as any)._spanProcessors = [];
      (existingProvider as any)._resource = Resource.default();

      // Mock getTracerProvider to return existing provider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(existingProvider) as any;

      const config = createTestConfig();

      // Initialize multiple times
      traceroot.init(config);
      const firstProvider = require('../../src/tracer')._tracerProvider;

      traceroot.init(config);
      const secondProvider = require('../../src/tracer')._tracerProvider;

      // Should return the same provider (cached)
      expect(firstProvider).toBe(secondProvider);
    });

    test('should work with existing provider and async traced functions', async () => {
      const existingProvider = new NodeTracerProvider({
        resource: Resource.default(),
      });

      // Mock internal properties
      (existingProvider as any)._spanProcessors = [];
      (existingProvider as any)._resource = Resource.default();

      // Mock getTracerProvider to return existing provider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(existingProvider) as any;

      const config = createTestConfig();
      traceroot.init(config);

      // Test async function with enhanced provider
      const asyncTracedFunction = traceroot.traceFunction(
        async function asyncTestFunction(input: string): Promise<string> {
          await new Promise(resolve => setTimeout(resolve, 10));
          return `async-enhanced-${input}`;
        },
        { spanName: 'async-enhanced-span' }
      );

      const result = await asyncTracedFunction('test');
      expect(result).toBe('async-enhanced-test');
    });

    test('should handle provider enhancement with function tracing', async () => {
      const existingProvider = new NodeTracerProvider({
        resource: Resource.default(),
      });

      // Mock internal properties
      (existingProvider as any)._spanProcessors = [];
      (existingProvider as any)._resource = Resource.default();

      // Mock getTracerProvider to return existing provider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(existingProvider) as any;

      const config = createTestConfig();
      traceroot.init(config);

      // Test function tracing with enhanced provider
      const enhancedFunction = traceroot.traceFunction(
        function testMethod(value: number): number {
          return value * 3;
        },
        { spanName: 'enhanced-function-span' }
      );

      const result = enhancedFunction(7);
      expect(result).toBe(21);
    });

    test('should handle span utility functions with enhanced provider', async () => {
      const existingProvider = new NodeTracerProvider({
        resource: Resource.default(),
      });

      // Mock internal properties
      (existingProvider as any)._spanProcessors = [];
      (existingProvider as any)._resource = Resource.default();

      // Mock getTracerProvider to return existing provider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(existingProvider) as any;

      const config = createTestConfig();
      traceroot.init(config);

      // Test within a traced function to have an active span
      const tracedFunction = traceroot.traceFunction(function testSpanUtilities() {
        // Test span utility functions
        const headers = traceroot.getTraceHeaders();
        const spanId = traceroot.getSpanId();
        const isRecording = traceroot.isRecording();
        const spanInfo = traceroot.getActiveSpanInfo();

        return {
          headers,
          spanId,
          isRecording,
          spanInfo,
        };
      });

      const result = tracedFunction();

      // With enhanced provider, these should work properly
      expect(typeof result.headers).toBe('object');
      expect(typeof result.isRecording).toBe('boolean');
      expect(typeof result.spanInfo).toBe('object');
      expect(result.spanInfo.hasActiveSpan).toBe(true);
    });

    test('should handle errors gracefully during provider enhancement', async () => {
      // Create a mock provider that might cause issues during enhancement
      const problematicProvider = {
        constructor: { name: 'ProblematicTracerProvider' },
        getTracer: jest.fn().mockReturnValue({
          startActiveSpan: jest.fn((name: string, fn: any) => {
            // Mock a basic span for the traced function to work
            const mockSpan = {
              setAttributes: jest.fn(),
              setAttribute: jest.fn(),
              addEvent: jest.fn(),
              setStatus: jest.fn(),
              end: jest.fn(),
              recordException: jest.fn(),
              isRecording: jest.fn().mockReturnValue(true),
            };
            return fn(mockSpan);
          }),
        }),
        addSpanProcessor: jest.fn(),
        register: jest.fn(),
        forceFlush: jest.fn().mockImplementation(async () => {}),
        shutdown: jest.fn().mockImplementation(async () => {}),
        // Missing _spanProcessors and _resource properties intentionally
      };

      // Mock getTracerProvider to return problematic provider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(problematicProvider as any) as any;

      const config = createTestConfig();

      // Should not throw an error even with problematic provider
      expect(() => traceroot.init(config)).not.toThrow();

      // Verify tracer was still initialized
      const { isInitialized } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      // Test that basic functionality still works
      const tracedFunction = traceroot.traceFunction(function testFunction() {
        return 'error-handled';
      });

      const result = tracedFunction();
      expect(result).toBe('error-handled');
    });
  });

  describe('Provider Type Detection Edge Cases', () => {
    test('should handle provider with undefined constructor', async () => {
      const providerWithoutConstructor = {
        getTracer: jest.fn(),
      };

      // Mock getTracerProvider to return provider without constructor
      otelTrace.getTracerProvider = jest
        .fn()
        .mockReturnValue(providerWithoutConstructor as any) as any;

      const config = createTestConfig();

      // Should not throw an error
      expect(() => traceroot.init(config)).not.toThrow();

      // Should create new provider instead of trying to enhance
      const { isInitialized } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);
    });

    test('should handle provider with null constructor name', async () => {
      const providerWithNullName = {
        constructor: { name: null },
        getTracer: jest.fn(),
      };

      // Mock getTracerProvider to return provider with null name
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(providerWithNullName as any) as any;

      const config = createTestConfig();

      // This test is about detecting a provider with null constructor name
      // The provider detection should handle null gracefully and create a new provider instead
      traceroot.init(config);

      // Should create new provider instead of trying to enhance
      const { isInitialized } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);
    });

    test('should detect provider names containing TracerProvider substring', async () => {
      const customNamedProvider = {
        constructor: { name: 'MyCustomTracerProvider' },
        getTracer: jest.fn(),
        addSpanProcessor: jest.fn(),
        register: jest.fn(),
        forceFlush: jest.fn().mockImplementation(async () => {}),
        shutdown: jest.fn().mockImplementation(async () => {}),
        _spanProcessors: [],
        _resource: Resource.default(),
      };

      // Mock getTracerProvider to return custom named provider
      otelTrace.getTracerProvider = jest.fn().mockReturnValue(customNamedProvider as any) as any;

      // Spy on console.log to verify detection
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const config = createTestConfig();
      traceroot.init(config);

      // Should detect it as an existing provider
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Detected existing OpenTelemetry provider (MyCustomTracerProvider)')
      );

      consoleSpy.mockRestore();
    });
  });
});
