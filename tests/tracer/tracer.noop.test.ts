/**
 * Tests for tracer behavior when both span exports are disabled (no-op tracer)
 */

// Disable auto-initialization for tests to avoid config file interference
process.env.TRACEROOT_DISABLE_AUTO_INIT = 'true';

import { jest } from '@jest/globals';
import * as traceroot from '../../src/index';
import { TraceRootConfig } from '../../src/config';
import { NoopSpanProcessor } from '@opentelemetry/sdk-trace-node';

// Mock the credential fetching function
jest.mock('../../src/api/credential', () => ({
  fetchAwsCredentialsSync: jest.fn(),
}));

describe('No-op Tracer Configuration', () => {
  // Set timeout for async operations
  jest.setTimeout(10000);

  afterEach(async () => {
    // Properly shutdown both tracer and logger to clean up all async operations
    await traceroot.shutdownTracing();
    await traceroot.shutdownLogger();
    jest.clearAllMocks();
  });

  describe('Both exports disabled', () => {
    test('should create no-op tracer when both span exports are disabled', async () => {
      const { fetchAwsCredentialsSync } = require('../../src/api/credential');

      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        local_mode: false,
        enable_span_cloud_export: false,
        enable_span_console_export: false,
        enable_log_console_export: true, // Only log console should work
        token: 'test-token',
      };

      // Initialize with both span exports disabled
      traceroot.init(testConfig);

      // Verify that AWS credentials were not fetched
      expect(fetchAwsCredentialsSync).not.toHaveBeenCalled();

      // Verify tracer is initialized
      const { isInitialized, getConfig } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      const config = getConfig();
      expect(config?.enable_span_cloud_export).toBe(false);
      expect(config?.enable_span_console_export).toBe(false);
      expect(config?.enable_log_console_export).toBe(true);
    });

    test('should handle traced functions gracefully with no-op tracer', async () => {
      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        enable_span_cloud_export: false,
        enable_span_console_export: false,
        token: 'test-token',
      };

      traceroot.init(testConfig);

      // Test that traced functions still work (they just don't create real spans)
      const tracedFunction = traceroot.traceFunction(
        function testFunction(input: string) {
          return `result-${input}`;
        },
        {
          spanName: 'noop-test-span',
          traceParams: true,
          traceReturnValue: true,
        }
      );

      const result = tracedFunction('test-input');
      expect(result).toBe('result-test-input');
    });

    test('should handle async traced functions with no-op tracer', async () => {
      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        enable_span_cloud_export: false,
        enable_span_console_export: false,
        token: 'test-token',
      };

      traceroot.init(testConfig);

      // Test that async traced functions work with no-op tracer
      const asyncTracedFunction = traceroot.traceFunction(
        async function asyncTestFunction(input: string): Promise<string> {
          await new Promise(resolve => setTimeout(resolve, 10));
          return `async-result-${input}`;
        },
        { spanName: 'async-noop-test-span' }
      );

      const result = await asyncTracedFunction('async-input');
      expect(result).toBe('async-result-async-input');
    });

    test('should handle decorator syntax with no-op tracer', async () => {
      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        enable_span_cloud_export: false,
        enable_span_console_export: false,
        token: 'test-token',
      };

      traceroot.init(testConfig);

      // Test decorator syntax works with no-op tracer
      class TestClass {
        @traceroot.trace({ spanName: 'decorator-test-span' })
        testMethod(value: number): number {
          return value * 2;
        }
      }

      const testInstance = new TestClass();
      const result = testInstance.testMethod(21);
      expect(result).toBe(42);
    });

    test('should handle span utility functions gracefully with no-op tracer', async () => {
      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        enable_span_cloud_export: false,
        enable_span_console_export: false,
        token: 'test-token',
      };

      traceroot.init(testConfig);

      // Test span utility functions don't crash with no-op tracer
      const headers = traceroot.getTraceHeaders();
      expect(headers).toEqual({});

      const spanId = traceroot.getSpanId();
      expect(spanId).toBeNull();

      const isRecording = traceroot.isRecording();
      expect(isRecording).toBe(false);

      const spanInfo = traceroot.getActiveSpanInfo();
      expect(spanInfo).toEqual({
        traceId: null,
        spanId: null,
        isRecording: false,
        hasActiveSpan: false,
      });
    });

    test('should work with default configuration from environment variables', async () => {
      const { fetchAwsCredentialsSync } = require('../../src/api/credential');

      // Set environment variables to simulate no config file scenario
      process.env.TRACEROOT_SERVICE_NAME = 'env-test-service';
      process.env.TRACEROOT_GITHUB_OWNER = 'env-owner';
      process.env.TRACEROOT_GITHUB_REPO_NAME = 'env-repo';
      process.env.TRACEROOT_GITHUB_COMMIT_HASH = 'env-commit';
      process.env.TRACEROOT_ENABLE_SPAN_CLOUD_EXPORT = 'false';
      process.env.TRACEROOT_ENABLE_SPAN_CONSOLE_EXPORT = 'false';
      process.env.TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT = 'true';

      try {
        // Initialize without explicit config (should use env vars)
        const { loadConfigFromEnv } = require('../../src/utils/configLoader');
        const envConfig = loadConfigFromEnv();
        traceroot.init(envConfig);

        // Verify that AWS credentials were not fetched
        expect(fetchAwsCredentialsSync).not.toHaveBeenCalled();

        const { isInitialized, getConfig } = require('../../src/tracer');
        expect(isInitialized()).toBe(true);

        const config = getConfig();
        expect(config?.service_name).toBe('env-test-service');
        expect(config?.github_owner).toBe('env-owner');
        expect(config?.github_repo_name).toBe('env-repo');
        expect(config?.github_commit_hash).toBe('env-commit');
        expect(config?.enable_span_cloud_export).toBe(false);
        expect(config?.enable_span_console_export).toBe(false);
        expect(config?.enable_log_console_export).toBe(true);

        // Test that traced functions still work
        const tracedFunction = traceroot.traceFunction(function envTestFunction() {
          return 'env-test-result';
        });

        const result = tracedFunction();
        expect(result).toBe('env-test-result');
      } finally {
        // Clean up environment variables
        delete process.env.TRACEROOT_SERVICE_NAME;
        delete process.env.TRACEROOT_GITHUB_OWNER;
        delete process.env.TRACEROOT_GITHUB_REPO_NAME;
        delete process.env.TRACEROOT_GITHUB_COMMIT_HASH;
        delete process.env.TRACEROOT_ENABLE_SPAN_CLOUD_EXPORT;
        delete process.env.TRACEROOT_ENABLE_SPAN_CONSOLE_EXPORT;
        delete process.env.TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT;
      }
    });

    test('should handle missing configuration gracefully with fallback defaults', async () => {
      const testConfig: Partial<TraceRootConfig> = {
        // Minimal config with missing required fields
        enable_span_cloud_export: false,
        enable_span_console_export: false,
        token: 'test-token',
      };

      // Should not throw error due to default value handling
      expect(() => traceroot.init(testConfig)).not.toThrow();

      const { isInitialized, getConfig } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      const config = getConfig();
      // Verify defaults were applied
      expect(config?.service_name).toBe('default-service');
      expect(config?.github_owner).toBe('unknown');
      expect(config?.github_repo_name).toBe('unknown');
      expect(config?.github_commit_hash).toBe('unknown');
    });
  });

  describe('Performance with no-op tracer', () => {
    test('should have minimal overhead with no-op tracer', async () => {
      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'perf-test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        enable_span_cloud_export: false,
        enable_span_console_export: false,
        token: 'test-token',
      };

      traceroot.init(testConfig);

      // Test that many traced function calls don't cause memory/performance issues
      const tracedFunction = traceroot.traceFunction(function perfTestFunction(n: number) {
        return n * 2;
      });

      const iterations = 1000;
      const start = Date.now();

      for (let i = 0; i < iterations; i++) {
        const result = tracedFunction(i);
        expect(result).toBe(i * 2);
      }

      const end = Date.now();
      const duration = end - start;

      // With no-op tracer, this should be very fast (less than 1 second for 1000 calls)
      expect(duration).toBeLessThan(1000);
    });
  });
});
