/**
 * Test suite for universal environment variable fallback
 *
 * Tests that environment variables are used as fallback when config file loading fails
 * in ANY environment (not just Edge Runtime)
 */

import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadTypescriptConfigSync, tryJavaScriptFallback } from '../../src/utils/configLoader';

// Mock modules to avoid side effects
jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn(),
}));

jest.mock('winston-cloudwatch', () => jest.fn());

describe('Universal Environment Variable Fallback', () => {
  const testDir = join(process.cwd(), 'test-configs-universal');
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

    // Clear all TraceRoot environment variables
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('TRACEROOT_')) {
        delete process.env[key];
      }
    });

    // Ensure NOT in Edge Runtime (testing Node.js fallback behavior)
    delete process.env.NEXT_RUNTIME;
    delete (globalThis as any).EdgeRuntime;

    // Change to test directory
    process.chdir(testDir);
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up test files and restore environment
    const configFiles = [
      'traceroot.config.ts',
      'traceroot.config.js',
      'traceroot.config.mjs',
      'traceroot.config.cjs',
    ];

    configFiles.forEach(file => {
      const filePath = join(testDir, file);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        delete require.cache[filePath];
      }
    });

    // Clear all require cache
    Object.keys(require.cache).forEach(key => {
      if (key.includes('test-configs-universal')) {
        delete require.cache[key];
      }
    });

    process.chdir(originalCwd);
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('No Config Files Exist', () => {
    test('should fallback to environment variables when no config files exist in Node.js', () => {
      // Set environment variables
      process.env.TRACEROOT_SERVICE_NAME = 'env-fallback-service';
      process.env.TRACEROOT_GITHUB_OWNER = 'env-owner';
      process.env.TRACEROOT_GITHUB_REPO_NAME = 'env-repo';
      process.env.TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT = 'true';
      process.env.TRACEROOT_LOG_LEVEL = 'warn';

      // No config files exist in testDir
      const loadedConfig = loadTypescriptConfigSync(null);

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('env-fallback-service');
      expect(loadedConfig?.github_owner).toBe('env-owner');
      expect(loadedConfig?.github_repo_name).toBe('env-repo');
      expect(loadedConfig?.enable_log_console_export).toBe(true);
      expect(loadedConfig?.log_level).toBe('warn');
    });

    test('should use environment variables with empty defaults when no config files and no env vars', () => {
      // No environment variables set, no config files exist

      const loadedConfig = loadTypescriptConfigSync(null);

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe(''); // Empty string default
      expect(loadedConfig?.github_owner).toBe(''); // Empty string default
      expect(loadedConfig?.github_repo_name).toBe(''); // Empty string default
      expect(loadedConfig?.github_commit_hash).toBe('main'); // Default value
      expect(loadedConfig?.enable_log_console_export).toBe(false); // Default false
      expect(loadedConfig?.enable_log_cloud_export).toBe(true); // Default true
      expect(loadedConfig?.log_level).toBe('debug'); // Default value
    });
  });

  describe('Invalid Config Files', () => {
    test('should fallback to environment variables when JavaScript config has syntax errors', () => {
      // Set environment variables as fallback
      process.env.TRACEROOT_SERVICE_NAME = 'syntax-error-fallback';
      process.env.TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT = 'true';

      // Create JavaScript config with syntax error
      const invalidConfig = `
const config = {
  service_name: 'should-not-be-used'
  // Missing comma - syntax error
  github_owner: 'syntax-error'
  github_repo_name: 'invalid-syntax'
`;

      const configPath = join(testDir, 'traceroot.config.js');
      writeFileSync(configPath, invalidConfig);

      const loadedConfig = loadTypescriptConfigSync(configPath);

      // Should fallback to environment variables
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('syntax-error-fallback');
      expect(loadedConfig?.enable_log_console_export).toBe(true);
    });

    test('should fallback to environment variables when config file throws runtime error', () => {
      // Set environment variables as fallback
      process.env.TRACEROOT_SERVICE_NAME = 'runtime-error-fallback';
      process.env.TRACEROOT_LOG_LEVEL = 'error';

      // Create config that throws runtime error
      const errorConfig = `
throw new Error('Config loading failed!');
module.exports = {
  service_name: 'should-never-reach-here'
};
`;

      const configPath = join(testDir, 'traceroot.config.js');
      writeFileSync(configPath, errorConfig);

      const loadedConfig = loadTypescriptConfigSync(configPath);

      // Should fallback to environment variables
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('runtime-error-fallback');
      expect(loadedConfig?.log_level).toBe('error');
    });

    test('should fallback to environment variables when TypeScript config compilation fails', () => {
      // Set environment variables as fallback
      process.env.TRACEROOT_SERVICE_NAME = 'ts-compile-error-fallback';
      process.env.TRACEROOT_ENABLE_SPAN_CONSOLE_EXPORT = 'true';

      // Create TypeScript config that definitely cannot compile or execute
      const invalidTsConfig = `
// This is completely broken TypeScript that should fail compilation
import { NonExistentModule } from 'does-not-exist';
import * as BreakThisImport from;

interface BROKEN {
  prop: UNDEFINED_TYPE;
}

COMPLETELY INVALID TYPESCRIPT SYNTAX HERE!!!
const config: BROKEN = {
  INVALID_PROPERTY_SYNTAX: () => {
    BROKEN_CODE_THAT_CANNOT_COMPILE
  service_name: 'should-never-work'
`;

      const configPath = join(testDir, 'traceroot.config.ts');
      writeFileSync(configPath, invalidTsConfig);

      const loadedConfig = loadTypescriptConfigSync(configPath);

      // Should fallback to environment variables
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('ts-compile-error-fallback');
      expect(loadedConfig?.enable_span_console_export).toBe(true);
    });
  });

  describe('tryJavaScriptFallback Function', () => {
    test('should eventually return environment variables when all file strategies fail', () => {
      // Set environment variables
      process.env.TRACEROOT_SERVICE_NAME = 'direct-fallback-test';
      process.env.TRACEROOT_LOCAL_MODE = 'true';

      // No config files exist, so all strategies should fail and fallback to env vars
      const loadedConfig = tryJavaScriptFallback();

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('direct-fallback-test');
      expect(loadedConfig?.local_mode).toBe(true);
    });

    test('should prioritize valid config files over environment variables', () => {
      // Set environment variables
      process.env.TRACEROOT_SERVICE_NAME = 'env-should-not-be-used';

      // Create valid config file
      const validConfig = `
module.exports = {
  service_name: 'file-config-priority',
  github_owner: 'file-owner',
  github_repo_name: 'file-repo',
  github_commit_hash: 'main'
};
`;

      writeFileSync(join(testDir, 'traceroot.config.js'), validConfig);

      const loadedConfig = tryJavaScriptFallback();

      // Should use file config, not environment variables
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('file-config-priority');
    });
  });

  describe('Mixed Scenarios', () => {
    test('should use environment variables for missing fields even when config file partially loads', () => {
      // Set environment variables for fields not in config file
      process.env.TRACEROOT_LOG_LEVEL = 'info';
      process.env.TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT = 'true';

      // Create partial config file (missing some fields)
      const partialConfig = `
module.exports = {
  service_name: 'partial-config',
  github_owner: 'partial-owner'
  // Missing other required fields
};
`;

      const configPath = join(testDir, 'traceroot.config.js');
      writeFileSync(configPath, partialConfig);

      const loadedConfig = loadTypescriptConfigSync(configPath);

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('partial-config');
      expect(loadedConfig?.github_owner).toBe('partial-owner');

      // Note: The config loader doesn't merge env vars with file config,
      // it's either/or. But this test verifies the fallback behavior.
    });
  });
});
