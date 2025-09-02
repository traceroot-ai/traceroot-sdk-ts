/**
 * Test suite for scenarios with no config files and no environment variables
 *
 * This test ensures that:
 * 1. No config.ts/js files are available in the project root
 * 2. No environment variables are set
 * 3. Console logger still works with default TraceRoot configuration
 */

import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadTypescriptConfigSync } from '../../src/utils/configLoader';
import { TraceRootConfigImpl } from '../../src/config';

// Mock modules to avoid side effects
jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn(),
}));

jest.mock('winston-cloudwatch', () => jest.fn());

describe('No Config Files + No Environment Variables', () => {
  const testDir = join(process.cwd(), 'test-configs-no-config-no-env');
  const originalCwd = process.cwd();
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear ALL TraceRoot environment variables
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('TRACEROOT_')) {
        delete process.env[key];
      }
    });

    // Ensure NOT in Edge Runtime
    delete process.env.NEXT_RUNTIME;
    delete (globalThis as any).EdgeRuntime;

    // Change to test directory (which has no config files)
    process.chdir(testDir);
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any config files that might have been created during tests
    const configFiles = [
      'traceroot.config.ts',
      'traceroot.config.js',
      'traceroot.config.mjs',
      'traceroot.config.cjs',
      'config.ts',
      'config.js',
    ];

    configFiles.forEach(file => {
      const filePath = join(testDir, file);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        delete require.cache[filePath];
      }
    });

    // Clear all require cache for test directory
    Object.keys(require.cache).forEach(key => {
      if (key.includes('test-configs-no-config-no-env')) {
        delete require.cache[key];
      }
    });

    process.chdir(originalCwd);
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Default Configuration Loading', () => {
    test('should load default config when no config files and no env vars exist', () => {
      // Verify no config files exist
      const configFiles = ['traceroot.config.ts', 'traceroot.config.js', 'config.ts', 'config.js'];
      configFiles.forEach(file => {
        expect(existsSync(join(testDir, file))).toBe(false);
      });

      // Verify no TraceRoot env vars are set
      Object.keys(process.env).forEach(key => {
        expect(key.startsWith('TRACEROOT_')).toBe(false);
      });

      // Load raw config - should fall back to environment variable defaults
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
      expect(finalConfig.enable_log_console_export).toBe(true); // Class default applied
      expect(finalConfig.enable_log_cloud_export).toBe(false); // Class default applied
      expect(finalConfig.log_level).toBe('debug'); // Default value
    });

    test('should create TraceRootConfigImpl with minimal required fields and enable console logging', () => {
      // Load config with no files and no env vars
      const loadedConfig = loadTypescriptConfigSync(null);

      expect(loadedConfig).not.toBeNull();

      // Create minimal config for TraceRootConfigImpl to work using loaded defaults
      const minimalConfig = {
        service_name: loadedConfig?.service_name || 'default-service',
        github_owner: loadedConfig?.github_owner || 'unknown',
        github_repo_name: loadedConfig?.github_repo_name || 'unknown',
        github_commit_hash: loadedConfig?.github_commit_hash || 'unknown',
        enable_log_console_export: true, // Force enable console logging for testing
        log_level: loadedConfig?.log_level || 'debug',
      };

      // Create TraceRootConfigImpl instance
      const configImpl = new TraceRootConfigImpl(minimalConfig);

      // Verify console logging is enabled
      expect(configImpl.enable_log_console_export).toBe(true);
      expect(configImpl.log_level).toBe('debug');
      expect(configImpl.service_name).toBe('default-service');
      expect(configImpl.github_owner).toBe('unknown');
      expect(configImpl.github_repo_name).toBe('unknown');
      expect(configImpl._sub_name).toBe('default-service-development');
    });
  });

  describe('Console Logger Verification', () => {
    test('should verify console logger works with default config when no external config exists', () => {
      // Verify clean environment
      expect(existsSync(join(testDir, 'traceroot.config.ts'))).toBe(false);
      expect(existsSync(join(testDir, 'traceroot.config.js'))).toBe(false);
      expect(process.env.TRACEROOT_SERVICE_NAME).toBeUndefined();

      // Load config (will use environment variable defaults)
      loadTypescriptConfigSync(null);

      // Create a working config with console logging enabled
      const workingConfig = new TraceRootConfigImpl({
        service_name: 'console-test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'main',
        enable_log_console_export: true,
        log_level: 'debug',
      });

      // Verify the config is set up for console logging
      expect(workingConfig.enable_log_console_export).toBe(true);
      expect(workingConfig.log_level).toBe('debug');
      expect(workingConfig.service_name).toBe('console-test-service');

      // Verify that this config would work for logging
      expect(workingConfig._sub_name).toBe('console-test-service-development');
      expect(workingConfig.environment).toBe('development');
    });

    test('should verify actual console logging works with minimal config and no env/config files', async () => {
      // Mock stdout to capture console output from Winston
      const originalWrite = process.stdout.write;
      const consoleOutput: string[] = [];
      process.stdout.write = jest.fn((chunk: any) => {
        consoleOutput.push(chunk.toString());
        return true;
      });

      try {
        // Verify clean environment
        expect(existsSync(join(testDir, 'traceroot.config.ts'))).toBe(false);
        expect(existsSync(join(testDir, 'traceroot.config.js'))).toBe(false);
        expect(process.env.TRACEROOT_SERVICE_NAME).toBeUndefined();

        // Create minimal config with console logging enabled
        const { TraceRootLogger, setGlobalConfig } = require('../../src/logger');

        const minimalConfig = new TraceRootConfigImpl({
          service_name: 'test-no-config-service',
          github_owner: 'test-owner',
          github_repo_name: 'test-repo',
          github_commit_hash: 'main',
          enable_log_console_export: true,
          enable_log_cloud_export: false,
          local_mode: true,
          log_level: 'info',
        });

        // Set up the global config (simulating TraceRoot.init())
        setGlobalConfig(minimalConfig);

        // Create a logger using the TraceRootLogger directly
        const logger = TraceRootLogger.create(minimalConfig, 'test-logger');

        // Test that console logging actually works
        await logger.info('Test console log message from no-config test');

        // Give a brief moment for async logging to complete
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify console output was captured
        expect(consoleOutput.length).toBeGreaterThan(0);
        const combinedOutput = consoleOutput.join('');
        expect(combinedOutput).toContain('Test console log message from no-config test');
        expect(combinedOutput).toContain('INFO'); // Check for INFO (with or without color codes)
        expect(combinedOutput).toContain('test-logger');
      } finally {
        // Restore original stdout.write
        process.stdout.write = originalWrite;
      }
    });

    test('should verify default TraceRootConfig enables console export by default in implementation', () => {
      // Create config with minimal required fields
      const basicConfig = new TraceRootConfigImpl({
        service_name: 'basic-service',
        github_owner: 'basic-owner',
        github_repo_name: 'basic-repo',
        github_commit_hash: 'main',
      });

      // Verify defaults are applied correctly
      expect(basicConfig.enable_log_console_export).toBe(true); // Class default is now true
      expect(basicConfig.enable_span_console_export).toBe(false);
      expect(basicConfig.log_level).toBe('debug');
      expect(basicConfig.environment).toBe('development');
      expect(basicConfig.aws_region).toBe('us-west-2');
      expect(basicConfig.otlp_endpoint).toBe('http://localhost:4318/v1/traces');
    });

    test('should work when explicitly enabling console export in config', () => {
      // Create config with console logging explicitly enabled
      const consoleEnabledConfig = new TraceRootConfigImpl({
        service_name: 'console-enabled-service',
        github_owner: 'console-owner',
        github_repo_name: 'console-repo',
        github_commit_hash: 'main',
        enable_log_console_export: true,
        enable_span_console_export: true,
        log_level: 'info',
      });

      // Verify console exports are enabled
      expect(consoleEnabledConfig.enable_log_console_export).toBe(true);
      expect(consoleEnabledConfig.enable_span_console_export).toBe(true);
      expect(consoleEnabledConfig.log_level).toBe('info');
      expect(consoleEnabledConfig._sub_name).toBe('console-enabled-service-development');
    });
  });

  describe('Auto-initialization Tests', () => {
    test('should auto-initialize successfully when no config file exists', () => {
      // Verify clean environment - no config files
      const configFiles = ['traceroot.config.ts', 'traceroot.config.js', 'config.ts', 'config.js'];
      configFiles.forEach(file => {
        expect(existsSync(join(testDir, file))).toBe(false);
      });

      // Clear module cache to test fresh auto-initialization
      Object.keys(require.cache).forEach(key => {
        if (
          key.includes('src/index') ||
          key.includes('src/autoInit') ||
          key.includes('src/tracer') ||
          key.includes('src/logger')
        ) {
          delete require.cache[key];
        }
      });

      // Mock console to capture any debug messages
      const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();

      try {
        // Import autoInitialize function directly to test it
        const { autoInitialize } = require('../../src/autoInit');

        // Test that autoInitialize returns true even with no config file
        const result = autoInitialize();

        // Check if there were any error messages that might explain failure
        const debugCalls = consoleDebugSpy.mock.calls;
        if (!result) {
          console.log('Debug calls:', debugCalls);
          console.log('Auto-initialize failed - investigating...');
        }

        expect(result).toBe(true);
      } finally {
        consoleDebugSpy.mockRestore();
      }
    });

    test('should allow getLogger() to work after auto-initialization with no config', () => {
      // Clear module cache for fresh test
      Object.keys(require.cache).forEach(key => {
        if (key.includes('src/') && key.includes('traceroot-sdk-ts/src/')) {
          delete require.cache[key];
        }
      });

      // Import and trigger auto-initialization (this happens automatically on import)
      const TraceRoot = require('../../src/index');

      // This should NOT throw "Logger not initialized" error anymore
      expect(() => {
        const logger = TraceRoot.getLogger();
        expect(logger).toBeDefined();
      }).not.toThrow();
    });

    test('should work in NextJS middleware scenario (no config file, immediate logger use)', async () => {
      // Simulate NextJS middleware scenario where:
      // 1. No config file exists
      // 2. Module is imported and auto-initialization runs
      // 3. Middleware immediately tries to create logger

      // Clear module cache
      Object.keys(require.cache).forEach(key => {
        if (key.includes('src/') && key.includes('traceroot-sdk-ts/src/')) {
          delete require.cache[key];
        }
      });

      // Mock console.error to capture any error messages
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      try {
        // Import TraceRoot (triggers auto-initialization)
        const TraceRoot = require('../../src/index');

        // Immediately try to create logger (like middleware would)
        const logger = TraceRoot.getLogger();

        // Test that logger is functional
        await logger.info('Test message from simulated middleware');

        // Should not have thrown any errors
        expect(logger).toBeDefined();
        expect(consoleSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Logger not initialized')
        );

        // The main success criteria is that getLogger() worked without throwing
        // "Logger not initialized" error, which means auto-initialization succeeded
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  describe('Edge Cases', () => {
    test('should handle completely clean environment with no files in test directory', () => {
      // Double-check we're in a clean test directory (originalCwd may have config files which is expected)
      const files = ['traceroot.config.ts', 'traceroot.config.js', 'config.ts', 'config.js'];
      files.forEach(file => {
        expect(existsSync(join(testDir, file))).toBe(false);
      });

      // Verify we're in the test directory, not the original cwd
      expect(process.cwd()).toBe(testDir);

      // Verify no TraceRoot environment variables
      expect(Object.keys(process.env).filter(key => key.startsWith('TRACEROOT_'))).toHaveLength(0);

      // Load config - should return env var defaults
      const config = loadTypescriptConfigSync(null);

      expect(config).not.toBeNull();
      expect(typeof config?.service_name).toBe('string'); // Should be empty string
      expect(typeof config?.github_owner).toBe('string'); // Should be empty string
      expect(typeof config?.github_repo_name).toBe('string'); // Should be empty string
      expect(config?.github_commit_hash).toBe('unknown');
      expect(config?.log_level).toBe('debug');
    });
  });
});
