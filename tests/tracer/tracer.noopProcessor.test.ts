/**
 * Tests for NoopSpanProcessor when both span exports are disabled
 */

// Disable auto-initialization for tests to avoid config file interference
process.env.TRACEROOT_DISABLE_AUTO_INIT = 'true';

import { jest } from '@jest/globals';
import * as traceroot from '../../src/index';
import { TraceRootConfig } from '../../src/config';

// Mock the credential fetching function
jest.mock('../../src/api/credential', () => ({
  fetchAwsCredentialsSync: jest.fn(),
}));

describe('NoopSpanProcessor Configuration', () => {
  // Set timeout for async operations
  jest.setTimeout(10000);

  afterEach(async () => {
    // Properly shutdown both tracer and logger to clean up all async operations
    await traceroot.shutdownTracing();
    await traceroot.shutdownLogger();
    jest.clearAllMocks();
  });

  describe('Both span exports disabled', () => {
    test('should use NoopSpanProcessor when both enable_span_cloud_export and enable_span_console_export are false', async () => {
      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        enable_span_cloud_export: false,
        enable_span_console_export: false,
        enable_log_console_export: true,
        token: 'test-token',
      };

      // Initialize with both span exports disabled
      traceroot.init(testConfig);

      // Verify tracer is initialized
      const { isInitialized } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      // Test that no spans are actually processed/exported by checking console output
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      // Execute a traced function that should generate a span
      const tracedFunction = traceroot.traceFunction(
        function testFunction() {
          return 'test-result';
        },
        { spanName: 'noop-processor-test-span', traceParams: true, traceReturnValue: true }
      );

      tracedFunction();

      // Wait for any async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify no span data was logged (indicating NoopSpanProcessor is being used)
      const spanLogs = consoleSpy.mock.calls.filter(call =>
        call.some(
          arg =>
            typeof arg === 'string' &&
            (arg.includes('span') ||
              arg.includes('trace') ||
              arg.includes('noop-processor-test-span'))
        )
      );
      expect(spanLogs.length).toBe(0);

      consoleSpy.mockRestore();
    });

    test('should not use NoopSpanProcessor when enable_span_console_export is true', async () => {
      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'console-test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        enable_span_cloud_export: false,
        enable_span_console_export: true,
        token: 'test-token',
      };

      // Initialize with console export enabled
      traceroot.init(testConfig);

      // Verify tracer is initialized and console export is enabled
      const { isInitialized, getConfig } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      const config = getConfig();
      expect(config?.enable_span_console_export).toBe(true);
      expect(config?.enable_span_cloud_export).toBe(false);

      // Verify traced functions still work
      const tracedFunction = traceroot.traceFunction(function testFunction() {
        return 'console-test-result';
      });

      const result = tracedFunction();
      expect(result).toBe('console-test-result');
    });

    test('should not use NoopSpanProcessor when enable_span_cloud_export is true', async () => {
      const { fetchAwsCredentialsSync } = require('../../src/api/credential');

      // Mock successful credentials fetch
      fetchAwsCredentialsSync.mockReturnValue({
        hash: 'test-hash',
        otlp_endpoint: 'http://test-endpoint:4318/v1/traces',
        aws_access_key_id: 'test-key',
        aws_secret_access_key: 'test-secret',
        aws_session_token: 'test-token',
        region: 'us-west-2',
        expiration_utc: new Date(Date.now() + 3600000),
      });

      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        enable_span_cloud_export: true,
        enable_span_console_export: false,
        token: 'test-token',
      };

      // Initialize with cloud export enabled
      traceroot.init(testConfig);

      // Verify tracer is initialized and AWS credentials were fetched
      const { isInitialized, getConfig } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);
      expect(fetchAwsCredentialsSync).toHaveBeenCalled();

      const config = getConfig();
      expect(config?.enable_span_cloud_export).toBe(true);
      expect(config?.otlp_endpoint).toBe('http://test-endpoint:4318/v1/traces');
    });

    test('should use both processors when both exports are enabled', async () => {
      const { fetchAwsCredentialsSync } = require('../../src/api/credential');

      // Mock successful credentials fetch
      fetchAwsCredentialsSync.mockReturnValue({
        hash: 'test-hash',
        otlp_endpoint: 'http://test-endpoint:4318/v1/traces',
        aws_access_key_id: 'test-key',
        aws_secret_access_key: 'test-secret',
        aws_session_token: 'test-token',
        region: 'us-west-2',
        expiration_utc: new Date(Date.now() + 3600000),
      });

      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        enable_span_cloud_export: true,
        enable_span_console_export: true,
        token: 'test-token',
      };

      // Initialize with both exports enabled
      traceroot.init(testConfig);

      // Verify both configurations are active
      const { isInitialized, getConfig } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);
      expect(fetchAwsCredentialsSync).toHaveBeenCalled();

      const config = getConfig();
      expect(config?.enable_span_cloud_export).toBe(true);
      expect(config?.enable_span_console_export).toBe(true);
    });

    test('should verify NoopSpanProcessor behavior - spans are not processed', async () => {
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

      // Create a spy to monitor console output (to ensure no spans are logged)
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      // Execute a traced function
      const tracedFunction = traceroot.traceFunction(
        function testFunction() {
          return 'test-result';
        },
        { spanName: 'noop-test-span', traceParams: true, traceReturnValue: true }
      );

      const result = tracedFunction();
      expect(result).toBe('test-result');

      // Wait a bit to ensure any async processing is done
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify no span information was logged to console
      const spanLogs = consoleSpy.mock.calls.filter(call =>
        call.some(arg => typeof arg === 'string' && arg.includes('span'))
      );
      expect(spanLogs.length).toBe(0);

      consoleSpy.mockRestore();
    });

    test('should handle configuration with undefined span export values', async () => {
      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        // Explicitly not setting span export properties (they should default to false)
        token: 'test-token',
      };

      // Should not throw when span exports are undefined
      expect(() => traceroot.init(testConfig)).not.toThrow();

      const { isInitialized, getConfig } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      const config = getConfig();
      // Check the actual configured values (they should default to false)
      expect(config?.enable_span_cloud_export).toBe(false);
      expect(config?.enable_span_console_export).toBe(false);
    });

    test('should maintain tracer functionality with NoopSpanProcessor', async () => {
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

      // Test all tracing utility functions work
      expect(() => {
        const headers = traceroot.getTraceHeaders();
        expect(headers).toEqual({});

        const spanId = traceroot.getSpanId();
        expect(spanId).toBeNull();

        const isRecording = traceroot.isRecording();
        expect(isRecording).toBe(false);

        const spanInfo = traceroot.getActiveSpanInfo();
        expect(spanInfo.hasActiveSpan).toBe(false);
      }).not.toThrow();
    });
  });

  describe('Edge cases', () => {
    test('should handle local_mode with both span exports disabled', async () => {
      const { fetchAwsCredentialsSync } = require('../../src/api/credential');

      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        local_mode: true,
        enable_span_cloud_export: false,
        enable_span_console_export: false,
        token: 'test-token',
      };

      expect(() => traceroot.init(testConfig)).not.toThrow();

      // Verify AWS credentials were not fetched due to local_mode
      expect(fetchAwsCredentialsSync).not.toHaveBeenCalled();

      const { isInitialized, getConfig } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      const config = getConfig();
      expect(config?.local_mode).toBe(true);
      expect(config?.enable_span_cloud_export).toBe(false);
      expect(config?.enable_span_console_export).toBe(false);
    });

    test('should handle repeated initialization calls', async () => {
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

      // First initialization
      traceroot.init(testConfig);
      const { isInitialized: isInitialized1 } = require('../../src/tracer');
      expect(isInitialized1()).toBe(true);

      // Second initialization (should not throw)
      expect(() => traceroot.init(testConfig)).not.toThrow();
      const { isInitialized: isInitialized2 } = require('../../src/tracer');
      expect(isInitialized2()).toBe(true);
    });
  });
});
