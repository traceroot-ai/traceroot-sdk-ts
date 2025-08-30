/**
 * Test suite for Edge Runtime configuration loading
 *
 * This test focuses on Edge Runtime compatibility where fs module is not available
 * and configuration must be loaded from environment variables.
 */

import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { findTypescriptConfig, loadTypescriptConfigSync } from '../../src/utils/configLoader';
import { TraceRootConfigImpl } from '../../src/config';

// Mock modules to avoid side effects
jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn(),
}));

jest.mock('winston-cloudwatch', () => jest.fn());

describe('Edge Runtime Configuration Loading', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear all TraceRoot environment variables
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('TRACEROOT_')) {
        delete process.env[key];
      }
    });

    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Edge Runtime Detection', () => {
    test('should detect Edge Runtime via NEXT_RUNTIME environment variable', () => {
      process.env.NEXT_RUNTIME = 'edge';

      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBeNull(); // Should skip file-based config
    });

    test('should detect Edge Runtime via globalThis.EdgeRuntime', () => {
      // Mock EdgeRuntime on globalThis
      (globalThis as any).EdgeRuntime = {};

      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBeNull(); // Should skip file-based config

      // Clean up
      delete (globalThis as any).EdgeRuntime;
    });
  });

  describe('Environment Variable Configuration Loading', () => {
    beforeEach(() => {
      // Simulate Edge Runtime
      process.env.NEXT_RUNTIME = 'edge';
    });

    test('should load configuration from environment variables in Edge Runtime', () => {
      // Set up environment variables
      process.env.TRACEROOT_SERVICE_NAME = 'edge-test-service';
      process.env.TRACEROOT_GITHUB_OWNER = 'edge-owner';
      process.env.TRACEROOT_GITHUB_REPO_NAME = 'edge-repo';
      process.env.TRACEROOT_GITHUB_COMMIT_HASH = 'edge-commit';
      process.env.TRACEROOT_TOKEN = 'edge-token-123';
      process.env.TRACEROOT_ENVIRONMENT = 'edge-environment';
      process.env.TRACEROOT_ENABLE_SPAN_CONSOLE_EXPORT = 'true';
      process.env.TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT = 'true';
      process.env.TRACEROOT_ENABLE_SPAN_CLOUD_EXPORT = 'false';
      process.env.TRACEROOT_ENABLE_LOG_CLOUD_EXPORT = 'false';
      process.env.TRACEROOT_LOCAL_MODE = 'true';
      process.env.TRACEROOT_LOG_LEVEL = 'info';

      const loadedConfig = loadTypescriptConfigSync(null);

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('edge-test-service');
      expect(loadedConfig?.github_owner).toBe('edge-owner');
      expect(loadedConfig?.github_repo_name).toBe('edge-repo');
      expect(loadedConfig?.github_commit_hash).toBe('edge-commit');
      expect(loadedConfig?.token).toBe('edge-token-123');
      expect(loadedConfig?.environment).toBe('edge-environment');
      expect(loadedConfig?.enable_span_console_export).toBe(true);
      expect(loadedConfig?.enable_log_console_export).toBe(true);
      expect(loadedConfig?.enable_span_cloud_export).toBe(false);
      expect(loadedConfig?.enable_log_cloud_export).toBe(false);
      expect(loadedConfig?.local_mode).toBe(true);
      expect(loadedConfig?.log_level).toBe('info');
    });

    test('should use empty string defaults when environment variables are not set', () => {
      // No environment variables set

      const rawConfig = loadTypescriptConfigSync(null);
      expect(rawConfig).not.toBeNull();

      // Create TraceRootConfigImpl with the raw config to test final values
      const finalConfig = new TraceRootConfigImpl({
        service_name: rawConfig?.service_name || 'test-service',
        github_owner: rawConfig?.github_owner || 'test-owner',
        github_repo_name: rawConfig?.github_repo_name || 'test-repo',
        github_commit_hash: rawConfig?.github_commit_hash || 'main',
        ...rawConfig, // spread the rest of the optional properties
      });

      expect(finalConfig.service_name).toBe('default-service'); // From rawConfig (new default from env loader)
      expect(finalConfig.github_owner).toBe('unknown'); // From rawConfig (new default from env loader)
      expect(finalConfig.github_repo_name).toBe('unknown'); // From rawConfig (new default from env loader)
      expect(finalConfig.github_commit_hash).toBe('unknown'); // New default value
      expect(finalConfig.token).toBe(''); // From rawConfig (empty string from env loader)
      expect(finalConfig.environment).toBe('development'); // Class default applied
      expect(finalConfig.enable_span_console_export).toBe(false); // Class default applied
      expect(finalConfig.enable_log_console_export).toBe(true); // Class default applied
      expect(finalConfig.enable_span_cloud_export).toBe(false); // Class default applied
      expect(finalConfig.enable_log_cloud_export).toBe(false); // Class default applied
      expect(finalConfig.local_mode).toBe(false); // Class default applied
      expect(finalConfig.log_level).toBe('debug'); // Default value
    });

    test('should handle boolean environment variables correctly', () => {
      // Test various boolean representations
      process.env.TRACEROOT_ENABLE_SPAN_CONSOLE_EXPORT = 'true';
      process.env.TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT = 'false';
      process.env.TRACEROOT_ENABLE_SPAN_CLOUD_EXPORT = 'false'; // Should override default
      process.env.TRACEROOT_ENABLE_LOG_CLOUD_EXPORT = 'invalid'; // Should remain default (true)
      process.env.TRACEROOT_LOCAL_MODE = 'true';

      const loadedConfig = loadTypescriptConfigSync(null);

      expect(loadedConfig?.enable_span_console_export).toBe(true);
      expect(loadedConfig?.enable_log_console_export).toBe(false); // Explicitly set to false
      expect(loadedConfig?.enable_span_cloud_export).toBe(false);
      expect(loadedConfig?.enable_log_cloud_export).toBe(false); // Default false now
      expect(loadedConfig?.local_mode).toBe(true);
    });

    test('should use console logging by default in Edge Runtime with minimal config', () => {
      // Set only required minimal config for Edge Runtime
      process.env.TRACEROOT_SERVICE_NAME = 'minimal-edge-service';

      const rawConfig = loadTypescriptConfigSync(null);
      expect(rawConfig).not.toBeNull();

      // Create TraceRootConfigImpl with the raw config to test final values
      const finalConfig = new TraceRootConfigImpl({
        service_name: rawConfig?.service_name || 'test-service',
        github_owner: rawConfig?.github_owner || 'test-owner',
        github_repo_name: rawConfig?.github_repo_name || 'test-repo',
        github_commit_hash: rawConfig?.github_commit_hash || 'main',
        ...rawConfig, // spread the rest of the optional properties
      });

      expect(finalConfig.service_name).toBe('minimal-edge-service'); // From rawConfig (env var)

      // Console logging should be available (defaults)
      expect(finalConfig.enable_log_console_export).toBe(true); // Class default applied
      expect(finalConfig.enable_span_console_export).toBe(false); // Class default applied

      // Cloud exports should default to false now
      expect(finalConfig.enable_log_cloud_export).toBe(false); // Class default applied
      expect(finalConfig.enable_span_cloud_export).toBe(false); // Class default applied

      // Local mode should be false by default
      expect(finalConfig.local_mode).toBe(false); // Class default applied
    });

    test('should enable console logging when explicitly set in Edge Runtime', () => {
      process.env.TRACEROOT_SERVICE_NAME = 'console-enabled-service';
      process.env.TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT = 'true';
      process.env.TRACEROOT_ENABLE_SPAN_CONSOLE_EXPORT = 'true';

      const loadedConfig = loadTypescriptConfigSync(null);

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.enable_log_console_export).toBe(true);
      expect(loadedConfig?.enable_span_console_export).toBe(true);
    });
  });

  describe('Invalid TRACEROOT_CONFIG_PATH Fallback', () => {
    test('should fallback to environment variables when TRACEROOT_CONFIG_PATH points to non-existent file', () => {
      // Create isolated test directory to avoid finding project root config
      const testDir = join(process.cwd(), 'test-edge-fallback');
      mkdirSync(testDir, { recursive: true });
      const originalCwd = process.cwd();

      try {
        // Change to isolated directory
        process.chdir(testDir);

        // Set invalid config path
        process.env.TRACEROOT_CONFIG_PATH = '/non/existent/path/traceroot.config.js';

        // Set environment variables for fallback
        process.env.TRACEROOT_SERVICE_NAME = 'fallback-service';
        process.env.TRACEROOT_GITHUB_OWNER = 'fallback-owner';
        process.env.TRACEROOT_GITHUB_REPO_NAME = 'fallback-repo';
        process.env.TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT = 'true';

        // Not in Edge Runtime, but config file doesn't exist
        delete process.env.NEXT_RUNTIME;

        // Test loading with the invalid path directly - should now fallback to environment variables
        const loadedConfig = loadTypescriptConfigSync('/non/existent/path/traceroot.config.js');

        // With universal fallback, should now return environment config instead of null
        expect(loadedConfig).not.toBeNull();
        expect(loadedConfig?.service_name).toBe('fallback-service');
        expect(loadedConfig?.enable_log_console_export).toBe(true);
      } finally {
        // Always restore and cleanup
        process.chdir(originalCwd);
        if (existsSync(testDir)) {
          rmSync(testDir, { recursive: true, force: true });
        }
      }
    });

    test('should use environment variables in Edge Runtime even with invalid TRACEROOT_CONFIG_PATH', () => {
      // Simulate Edge Runtime
      process.env.NEXT_RUNTIME = 'edge';

      // Set invalid config path (should be ignored in Edge Runtime)
      process.env.TRACEROOT_CONFIG_PATH = '/non/existent/path/traceroot.config.js';

      // Set environment variables
      process.env.TRACEROOT_SERVICE_NAME = 'edge-fallback-service';
      process.env.TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT = 'true';
      process.env.TRACEROOT_ENABLE_SPAN_CONSOLE_EXPORT = 'true';

      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBeNull(); // Should skip file loading in Edge Runtime

      const loadedConfig = loadTypescriptConfigSync(foundConfig);
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('edge-fallback-service');
      expect(loadedConfig?.enable_log_console_export).toBe(true);
      expect(loadedConfig?.enable_span_console_export).toBe(true);
    });
  });
});
