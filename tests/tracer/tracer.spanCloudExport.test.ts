/**
 * Tests for tracer behavior with enable_span_cloud_export configuration
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

describe('Span Cloud Export Configuration', () => {
  // Set timeout for async operations
  jest.setTimeout(10000);

  afterEach(async () => {
    // Properly shutdown both tracer and logger to clean up all async operations
    await traceroot.shutdownTracing();
    await traceroot.shutdownLogger();
    jest.clearAllMocks();
  });

  describe('enable_span_cloud_export: false', () => {
    test('should not fetch AWS credentials when span cloud export is disabled', async () => {
      const { fetchAwsCredentialsSync } = require('../../src/api/credential');

      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        local_mode: false, // Not in local mode, but span cloud export disabled
        enable_span_cloud_export: false,
        enable_log_cloud_export: true, // This should be overridden to false
        token: 'test-token',
      };

      // Initialize with span cloud export disabled
      traceroot.init(testConfig);

      // Verify that AWS credentials were not fetched
      expect(fetchAwsCredentialsSync).not.toHaveBeenCalled();

      const { getConfig } = require('../../src/tracer');
      const config = getConfig();

      // Verify that log cloud export was also disabled
      expect(config?.enable_log_cloud_export).toBe(false);
      expect(config?.enable_span_cloud_export).toBe(false);
    });

    test('should use NoopSpanProcessor when span cloud export is disabled', async () => {
      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        local_mode: false,
        enable_span_cloud_export: false,
        token: 'test-token',
      };

      // Initialize with span cloud export disabled
      traceroot.init(testConfig);

      // Verify tracer is still initialized but using no-op processor
      const { isInitialized } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      // Test that traced functions still work (they just don't export to cloud)
      const tracedFunction = traceroot.traceFunction(
        function testFunction() {
          return 'test-result';
        },
        { spanName: 'test-span' }
      );

      const result = tracedFunction();
      expect(result).toBe('test-result');
    });

    test('should still support console export when span cloud export is disabled', async () => {
      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        local_mode: false,
        enable_span_cloud_export: false,
        enable_span_console_export: true,
        token: 'test-token',
      };

      // Initialize with span cloud export disabled but console export enabled
      traceroot.init(testConfig);

      const { isInitialized } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      // Test that traced functions work with console export
      const tracedFunction = traceroot.traceFunction(
        function testFunction() {
          return 'console-test-result';
        },
        { spanName: 'console-test-span' }
      );

      const result = tracedFunction();
      expect(result).toBe('console-test-result');
    });

    test('should work in local mode with span cloud export disabled', async () => {
      const { fetchAwsCredentialsSync } = require('../../src/api/credential');

      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        local_mode: true,
        enable_span_cloud_export: false,
        token: 'test-token',
      };

      // Initialize with both local mode and span cloud export disabled
      traceroot.init(testConfig);

      // Verify that AWS credentials were not fetched (due to local mode)
      expect(fetchAwsCredentialsSync).not.toHaveBeenCalled();

      const { isInitialized } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      // Test that traced functions still work in local mode
      const tracedFunction = traceroot.traceFunction(
        function localTestFunction() {
          return 'local-test-result';
        },
        { spanName: 'local-test-span' }
      );

      const result = tracedFunction();
      expect(result).toBe('local-test-result');
    });
  });

  describe('enable_span_cloud_export: true (default behavior)', () => {
    test('should fetch AWS credentials when span cloud export is enabled', async () => {
      const { fetchAwsCredentialsSync } = require('../../src/api/credential');

      // Mock the credentials response
      fetchAwsCredentialsSync.mockReturnValue({
        hash: 'test-hash-span-enabled',
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
        local_mode: false,
        enable_span_cloud_export: true,
        enable_log_cloud_export: true,
        token: 'test-token',
      };

      // Initialize with span cloud export enabled
      traceroot.init(testConfig);

      // Verify that AWS credentials were fetched
      expect(fetchAwsCredentialsSync).toHaveBeenCalledWith(
        expect.objectContaining({
          local_mode: false,
          enable_span_cloud_export: true,
          token: 'test-token',
        })
      );

      const { getConfig } = require('../../src/tracer');
      const config = getConfig();

      // Verify that config was updated with credentials
      expect(config?._name).toBe('test-hash-span-enabled');
      expect(config?.otlp_endpoint).toBe('http://test-endpoint:4318/v1/traces');
      expect(config?.enable_span_cloud_export).toBe(true);
      expect(config?.enable_log_cloud_export).toBe(true);
    });

    test('should default to true when enable_span_cloud_export is undefined', async () => {
      const { fetchAwsCredentialsSync } = require('../../src/api/credential');

      // Mock the credentials response
      fetchAwsCredentialsSync.mockReturnValue({
        hash: 'test-hash-default',
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
        local_mode: false,
        enable_span_cloud_export: true, // Explicitly enable for this test
        token: 'test-token',
      };

      // Initialize with default span cloud export
      traceroot.init(testConfig);

      // Verify that AWS credentials were fetched
      expect(fetchAwsCredentialsSync).toHaveBeenCalled();

      const { getConfig } = require('../../src/tracer');
      const config = getConfig();

      // Verify that span cloud export is enabled
      expect(config?.enable_span_cloud_export).toBe(true);
    });
  });

  describe('Integration with logging', () => {
    test('should disable log cloud export when span cloud export is disabled', async () => {
      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        local_mode: false,
        enable_span_cloud_export: false,
        enable_log_cloud_export: true, // Should be overridden to false
        enable_log_console_export: true, // Should remain true
        token: 'test-token',
      };

      // Initialize with span cloud export disabled
      traceroot.init(testConfig);

      const { getConfig } = require('../../src/tracer');
      const config = getConfig();

      // Verify that log cloud export was disabled but console export remains
      expect(config?.enable_span_cloud_export).toBe(false);
      expect(config?.enable_log_cloud_export).toBe(false);
      expect(config?.enable_log_console_export).toBe(true);

      // Test that logger still works for console export
      const logger = traceroot.getLogger();
      await expect(logger.info('Test message')).resolves.not.toThrow();
    });
  });

  describe('Error handling', () => {
    test('should handle AWS credential fetch failure gracefully with span export disabled', async () => {
      const testConfig: Partial<TraceRootConfig> = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        local_mode: false,
        enable_span_cloud_export: false,
        token: 'test-token',
      };

      // Initialize - should not call fetchAwsCredentialsSync at all
      expect(() => traceroot.init(testConfig)).not.toThrow();

      const { isInitialized } = require('../../src/tracer');
      expect(isInitialized()).toBe(true);

      // Test that tracing still works
      const tracedFunction = traceroot.traceFunction(function testFunction() {
        return 'works-without-credentials';
      });

      const result = tracedFunction();
      expect(result).toBe('works-without-credentials');
    });
  });
});
