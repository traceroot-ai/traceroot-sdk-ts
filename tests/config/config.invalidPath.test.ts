/**
 * Test suite for invalid TRACEROOT_CONFIG_PATH handling
 *
 * This test focuses on fallback behavior when TRACEROOT_CONFIG_PATH
 * points to an invalid or non-existent file.
 */

import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  findTypescriptConfig,
  loadTypescriptConfigSync,
  tryJavaScriptFallback,
} from '../../src/utils/configLoader';

// Mock modules to avoid side effects
jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn(),
}));

jest.mock('winston-cloudwatch', () => jest.fn());

describe('Invalid TRACEROOT_CONFIG_PATH Handling', () => {
  const testDir = join(process.cwd(), 'test-configs-invalid');
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

    // Ensure not in Edge Runtime
    delete process.env.NEXT_RUNTIME;
    delete (globalThis as any).EdgeRuntime;

    // Change to test directory to isolate from root config files
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

    // Clear all require cache to avoid test interference
    Object.keys(require.cache).forEach(key => {
      if (key.includes('test-configs-invalid')) {
        delete require.cache[key];
      }
    });

    process.chdir(originalCwd);
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Invalid Config Path Scenarios', () => {
    test('should return environment variables when TRACEROOT_CONFIG_PATH points to non-existent file', () => {
      process.env.TRACEROOT_CONFIG_PATH = '/absolutely/non/existent/path/traceroot.config.js';

      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBeNull();

      const loadedConfig = loadTypescriptConfigSync(foundConfig);
      // With universal fallback, should return environment config instead of null
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('default-service'); // New default value
      expect(loadedConfig?.github_commit_hash).toBe('unknown'); // New default value
    });

    test('should return environment variables when TRACEROOT_CONFIG_PATH points to invalid file path', () => {
      process.env.TRACEROOT_CONFIG_PATH = 'invalid\0path\nwith\tspecial/chars';

      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBeNull();

      const loadedConfig = loadTypescriptConfigSync(foundConfig);
      // With universal fallback, should return environment config instead of null
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('default-service'); // New default value
      expect(loadedConfig?.github_commit_hash).toBe('unknown'); // New default value
    });

    test('should return environment variables when TRACEROOT_CONFIG_PATH is empty string', () => {
      process.env.TRACEROOT_CONFIG_PATH = '';

      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBeNull();

      const loadedConfig = loadTypescriptConfigSync(foundConfig);
      // With universal fallback, should return environment config instead of null
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('default-service'); // New default value
      expect(loadedConfig?.github_commit_hash).toBe('unknown'); // New default value
    });

    test('should return environment variables when TRACEROOT_CONFIG_PATH is just whitespace', () => {
      process.env.TRACEROOT_CONFIG_PATH = '   \t\n   ';

      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBeNull();

      const loadedConfig = loadTypescriptConfigSync(foundConfig);
      // With universal fallback, should return environment config instead of null
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('default-service'); // New default value
      expect(loadedConfig?.github_commit_hash).toBe('unknown'); // New default value
    });
  });

  describe('Fallback to Local Config Files', () => {
    test('should fallback to local JavaScript config when TRACEROOT_CONFIG_PATH is invalid', () => {
      // Set invalid path
      process.env.TRACEROOT_CONFIG_PATH = '/non/existent/config.js';

      // Create a local fallback config
      const jsConfig = `
const config = {
  service_name: 'fallback-js-service',
  github_owner: 'fallback-owner',
  github_repo_name: 'fallback-repo',
  github_commit_hash: 'main',
  environment: 'development',
  enable_log_console_export: true,
  enable_span_console_export: false,
  local_mode: false
};

module.exports = config;
`;

      writeFileSync(join(testDir, 'traceroot.config.js'), jsConfig);

      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBe(join(testDir, 'traceroot.config.js'));

      const loadedConfig = loadTypescriptConfigSync(foundConfig);
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('fallback-js-service');
      expect(loadedConfig?.enable_log_console_export).toBe(true);
    });

    test('should fallback to environment variables when both TRACEROOT_CONFIG_PATH and local configs fail', () => {
      // Set invalid path
      process.env.TRACEROOT_CONFIG_PATH = '/non/existent/config.js';

      // No local config files exist

      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBeNull();

      const loadedConfig = loadTypescriptConfigSync(foundConfig);
      // With universal fallback, should return environment config instead of null
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('default-service'); // New default value
      expect(loadedConfig?.github_commit_hash).toBe('unknown'); // New default value

      // Test the JavaScript fallback function directly
      const fallbackConfig = tryJavaScriptFallback();
      expect(fallbackConfig).not.toBeNull(); // Should return environment config when no config files exist
      expect(fallbackConfig?.service_name).toBe('default-service'); // New default value
    });
  });

  describe('Console Logging Verification in Invalid Path Scenarios', () => {
    test('should verify console logging works with valid fallback config when TRACEROOT_CONFIG_PATH is invalid', () => {
      // Create unique test subdirectory
      const testSubDir = join(testDir, 'console-test');
      mkdirSync(testSubDir, { recursive: true });
      process.chdir(testSubDir);

      // Set invalid path
      process.env.TRACEROOT_CONFIG_PATH = '/invalid/path/config.js';

      // Create a fallback config with console logging enabled
      const jsConfig = `
const config = {
  service_name: 'console-test-service',
  github_owner: 'test-owner',
  github_repo_name: 'test-repo',
  github_commit_hash: 'main',
  environment: 'development',
  enable_log_console_export: true,
  enable_span_console_export: true,
  enable_log_cloud_export: false,  // Disable cloud to focus on console
  enable_span_cloud_export: false, // Disable cloud to focus on console
  local_mode: false,
  log_level: 'debug'
};

module.exports = config;
`;

      const configFilePath = join(testSubDir, 'traceroot.config.js');
      writeFileSync(configFilePath, jsConfig);

      // Clear require cache to ensure fresh load
      delete require.cache[configFilePath];

      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBe(configFilePath);

      const loadedConfig = loadTypescriptConfigSync(foundConfig);
      expect(loadedConfig).not.toBeNull();

      // Verify the basic config is loaded correctly
      expect(loadedConfig?.service_name).toBe('console-test-service');
      expect(loadedConfig?.enable_log_console_export).toBe(true);
      expect(loadedConfig?.enable_span_console_export).toBe(true);
      expect(loadedConfig?.enable_log_cloud_export).toBe(false);
      expect(loadedConfig?.enable_span_cloud_export).toBe(false);
      expect(loadedConfig?.log_level).toBe('debug');
      expect(loadedConfig?.local_mode).toBe(false);
    });

    test('should handle mixed console/cloud export settings correctly', () => {
      // Create unique test subdirectory
      const testSubDir = join(testDir, 'mixed-test');
      mkdirSync(testSubDir, { recursive: true });
      process.chdir(testSubDir);

      // Set invalid path
      process.env.TRACEROOT_CONFIG_PATH = '/does/not/exist.js';

      // Create config with mixed export settings
      const mixedConfig = `
module.exports = {
  service_name: 'mixed-export-service',
  github_owner: 'test-owner',
  github_repo_name: 'test-repo',
  github_commit_hash: 'main',
  environment: 'development',
  enable_log_console_export: true,   // Console logs enabled
  enable_span_console_export: false, // Console spans disabled
  enable_log_cloud_export: true,     // Cloud logs enabled
  enable_span_cloud_export: false,   // Cloud spans disabled
  local_mode: false
};
`;

      const mixedConfigPath = join(testSubDir, 'traceroot.config.js');
      writeFileSync(mixedConfigPath, mixedConfig);

      // Clear require cache
      delete require.cache[mixedConfigPath];

      const foundConfig = findTypescriptConfig();
      const loadedConfig = loadTypescriptConfigSync(foundConfig);

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.enable_log_console_export).toBe(true);
      expect(loadedConfig?.enable_span_console_export).toBe(false);
      expect(loadedConfig?.enable_log_cloud_export).toBe(true);
      expect(loadedConfig?.enable_span_cloud_export).toBe(false);
    });
  });

  describe('Error Handling with Invalid Paths', () => {
    test('should handle directory instead of file in TRACEROOT_CONFIG_PATH', () => {
      // Point to a directory instead of a file
      process.env.TRACEROOT_CONFIG_PATH = testDir;

      const foundConfig = findTypescriptConfig();
      // Note: findTypescriptConfig doesn't validate that the path is a file vs directory
      // It will return the path if it exists, but loadTypescriptConfigSync should handle it

      const loadedConfig = loadTypescriptConfigSync(testDir); // Test loading directory directly
      // With universal fallback, should return environment config when directory loading fails
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('default-service'); // New default value
      expect(loadedConfig?.github_commit_hash).toBe('unknown'); // New default value
    });

    test('should handle permission denied scenarios gracefully', () => {
      // Create a path that would typically cause permission issues
      process.env.TRACEROOT_CONFIG_PATH = '/root/restricted/config.js';

      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBeNull();

      const loadedConfig = loadTypescriptConfigSync(foundConfig);
      // With universal fallback, should return environment config when permission denied
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('default-service'); // New default value
      expect(loadedConfig?.github_commit_hash).toBe('unknown'); // New default value
    });
  });
});
