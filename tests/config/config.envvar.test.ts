/**
 * Test suite for environment variable support in JavaScript configuration loading
 *
 * This test focuses specifically on the tryJavaScriptFallback function's
 * environment variable support, isolated from other config loading mechanisms.
 */

import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tryJavaScriptFallback } from '../../src/utils/configLoader';

// Mock modules to avoid side effects
jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn(),
}));

jest.mock('winston-cloudwatch', () => jest.fn());

describe('Environment Variable Configuration Loading', () => {
  const testDir = join(process.cwd(), 'test-configs-envvar');
  const originalCwd = process.cwd();
  const originalEnvVar = process.env.TRACEROOT_CONFIG_PATH;

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
    // Restore original environment variable
    if (originalEnvVar !== undefined) {
      process.env.TRACEROOT_CONFIG_PATH = originalEnvVar;
    } else {
      delete process.env.TRACEROOT_CONFIG_PATH;
    }
  });

  beforeEach(() => {
    // Change to test directory
    process.chdir(testDir);
    // Ensure environment variable is clean at start of each test
    delete process.env.TRACEROOT_CONFIG_PATH;

    // Clean up any existing config files from previous tests
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
        // Clear cache using absolute path
        const absolutePath = require('path').resolve(filePath);
        delete require.cache[absolutePath];
        delete require.cache[filePath];
      }
    });

    // Clear require cache to avoid test interference
    Object.keys(require.cache).forEach(key => {
      if (key.includes('test-configs-envvar') || key.includes('configLoader')) {
        delete require.cache[key];
      }
    });

    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up test files and restore cwd
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
        // Clear cache using absolute path
        const absolutePath = require('path').resolve(filePath);
        delete require.cache[absolutePath];
        delete require.cache[filePath];
      }
    });

    // Clean up env-config directory if it exists
    const envConfigDir = join(testDir, 'env-config');
    if (existsSync(envConfigDir)) {
      rmSync(envConfigDir, { recursive: true, force: true });
    }

    // Reset environment variable
    delete process.env.TRACEROOT_CONFIG_PATH;

    process.chdir(originalCwd);
    jest.restoreAllMocks();
  });

  describe('TRACEROOT_CONFIG_PATH Environment Variable', () => {
    test('should load config from TRACEROOT_CONFIG_PATH environment variable', () => {
      const jsConfig = `
const config = {
  service_name: 'env-var-direct-test',
  github_owner: 'traceroot-ai',
  github_repo_name: 'traceroot-sdk',
  github_commit_hash: 'main',
  environment: 'development',
  token: 'env-var-token-123',
  enable_span_console_export: false,
  enable_log_console_export: true,
  local_mode: false
};

module.exports = config;
`;

      // Create config file in a custom location
      const envConfigPath = join(testDir, 'custom-location', 'my-config.js');
      mkdirSync(join(testDir, 'custom-location'), { recursive: true });
      writeFileSync(envConfigPath, jsConfig);

      // Set environment variable
      process.env.TRACEROOT_CONFIG_PATH = envConfigPath;

      // Call tryJavaScriptFallback directly
      const loadedConfig = tryJavaScriptFallback();

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('env-var-direct-test');
      expect(loadedConfig?.token).toBe('env-var-token-123');
      expect(loadedConfig?.github_owner).toBe('traceroot-ai');
      expect(loadedConfig?.github_repo_name).toBe('traceroot-sdk');
      expect(loadedConfig?.enable_log_console_export).toBe(true);
      expect(loadedConfig?.local_mode).toBe(false);
    });

    test('should load config from absolute path via TRACEROOT_CONFIG_PATH', () => {
      const jsConfig = `
module.exports = {
  service_name: 'absolute-path-test',
  github_owner: 'test-org',
  github_repo_name: 'test-repo',
  github_commit_hash: 'test-commit',
  environment: 'test',
  token: 'absolute-path-token'
};
`;

      // Create config file with absolute path
      const absoluteConfigPath = join(testDir, 'absolute', 'config.js');
      mkdirSync(join(testDir, 'absolute'), { recursive: true });
      writeFileSync(absoluteConfigPath, jsConfig);

      // Set environment variable to absolute path
      process.env.TRACEROOT_CONFIG_PATH = absoluteConfigPath;

      const loadedConfig = tryJavaScriptFallback();

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('absolute-path-test');
      expect(loadedConfig?.token).toBe('absolute-path-token');
      expect(loadedConfig?.github_owner).toBe('test-org');
    });

    test('should handle config exported as function via environment variable', () => {
      const jsConfig = `
function createConfig() {
  return {
    service_name: 'function-env-test',
    github_owner: 'function-org',
    github_repo_name: 'function-repo',
    github_commit_hash: 'function-commit',
    environment: process.env.NODE_ENV || 'development',
    token: 'function-token',
    enable_span_console_export: true,
    enable_log_console_export: false,
    local_mode: true
  };
}

module.exports = createConfig;
`;

      const envConfigPath = join(testDir, 'function-config', 'config.js');
      mkdirSync(join(testDir, 'function-config'), { recursive: true });
      writeFileSync(envConfigPath, jsConfig);

      process.env.TRACEROOT_CONFIG_PATH = envConfigPath;

      const loadedConfig = tryJavaScriptFallback();

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('function-env-test');
      expect(loadedConfig?.token).toBe('function-token');
      expect(loadedConfig?.enable_span_console_export).toBe(true);
      expect(loadedConfig?.local_mode).toBe(true);
    });

    test('should handle config with default export via environment variable', () => {
      const jsConfig = `
const config = {
  service_name: 'default-export-env-test',
  github_owner: 'default-org',
  github_repo_name: 'default-repo',
  github_commit_hash: 'default-commit',
  environment: 'production',
  token: 'default-export-token'
};

module.exports = { default: config };
`;

      const envConfigPath = join(testDir, 'default-export', 'config.js');
      mkdirSync(join(testDir, 'default-export'), { recursive: true });
      writeFileSync(envConfigPath, jsConfig);

      process.env.TRACEROOT_CONFIG_PATH = envConfigPath;

      const loadedConfig = tryJavaScriptFallback();

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('default-export-env-test');
      expect(loadedConfig?.token).toBe('default-export-token');
      expect(loadedConfig?.environment).toBe('production');
    });
  });

  describe('Fallback Behavior', () => {
    test('should fallback to directory search when TRACEROOT_CONFIG_PATH file does not exist', () => {
      const jsConfig = `
const config = {
  service_name: 'directory-fallback-test',
  github_owner: 'fallback-org',
  github_repo_name: 'fallback-repo',
  github_commit_hash: 'fallback-commit',
  environment: 'test',
  token: 'fallback-token'
};

module.exports = config;
`;

      // Create config in current directory (fallback location)
      const configPath = join(testDir, 'traceroot.config.js');
      writeFileSync(configPath, jsConfig);

      // Set environment variable to non-existent file
      process.env.TRACEROOT_CONFIG_PATH = '/non/existent/path/config.js';

      const loadedConfig = tryJavaScriptFallback();

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('directory-fallback-test');
      expect(loadedConfig?.token).toBe('fallback-token');
      expect(loadedConfig?.github_owner).toBe('fallback-org');
    });

    test('should return null when both environment variable and directory search fail', () => {
      // Set environment variable to non-existent file
      process.env.TRACEROOT_CONFIG_PATH = '/non/existent/path/config.js';

      // Don't create any config files in the current directory

      const loadedConfig = tryJavaScriptFallback();

      expect(loadedConfig).toBeNull();
    });

    test('should prioritize environment variable over directory files', () => {
      // Create config in directory
      const directoryConfig = `
module.exports = {
  service_name: 'directory-config',
  github_owner: 'directory-org',
  github_repo_name: 'directory-repo',
  github_commit_hash: 'directory-commit',
  token: 'directory-token'
};
`;
      writeFileSync(join(testDir, 'traceroot.config.js'), directoryConfig);

      // Create config via environment variable
      const envConfig = `
module.exports = {
  service_name: 'env-config-priority',
  github_owner: 'env-org',
  github_repo_name: 'env-repo',
  github_commit_hash: 'env-commit',
  token: 'env-token'
};
`;
      const envConfigPath = join(testDir, 'priority-test', 'config.js');
      mkdirSync(join(testDir, 'priority-test'), { recursive: true });
      writeFileSync(envConfigPath, envConfig);

      process.env.TRACEROOT_CONFIG_PATH = envConfigPath;

      const loadedConfig = tryJavaScriptFallback();

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('env-config-priority');
      expect(loadedConfig?.token).toBe('env-token');
      expect(loadedConfig?.github_owner).toBe('env-org');
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid JavaScript syntax in environment variable config gracefully', () => {
      const invalidJsConfig = `
const config = {
  service_name: 'invalid-test'
  // Missing comma - this will cause syntax error
  github_owner: 'test-owner'
  // Missing closing brace and module.exports
`;

      const envConfigPath = join(testDir, 'invalid-config', 'config.js');
      mkdirSync(join(testDir, 'invalid-config'), { recursive: true });
      writeFileSync(envConfigPath, invalidJsConfig);

      process.env.TRACEROOT_CONFIG_PATH = envConfigPath;

      const loadedConfig = tryJavaScriptFallback();

      // Should return null due to syntax error
      expect(loadedConfig).toBeNull();
    });

    test('should handle environment variable pointing to directory instead of file', () => {
      // Create a directory instead of a file
      const dirPath = join(testDir, 'config-directory');
      mkdirSync(dirPath, { recursive: true });

      process.env.TRACEROOT_CONFIG_PATH = dirPath;

      const loadedConfig = tryJavaScriptFallback();

      // Should return null since it's a directory, not a file
      expect(loadedConfig).toBeNull();
    });

    test('should handle empty environment variable gracefully', () => {
      // First, clean up any existing config files in the test directory
      const configFiles = [
        'traceroot.config.js',
        'traceroot.config.mjs',
        'traceroot.config.cjs',
        'traceroot.config.ts',
      ];

      configFiles.forEach(file => {
        const filePath = join(testDir, file);
        if (existsSync(filePath)) {
          unlinkSync(filePath);
          delete require.cache[filePath];
        }
      });

      // Clear all require cache entries for this test directory
      Object.keys(require.cache).forEach(key => {
        if (key.includes('test-configs-envvar')) {
          delete require.cache[key];
        }
      });

      const jsConfig = `
module.exports = {
  service_name: 'empty-env-var-test',
  github_owner: 'empty-env-org',
  github_repo_name: 'empty-env-repo',
  github_commit_hash: 'empty-env-commit',
  token: 'empty-env-token'
};
`;

      // Create config in directory for fallback
      const configPath = join(testDir, 'traceroot.config.js');
      writeFileSync(configPath, jsConfig);

      // Verify the file was created and has the correct content
      expect(existsSync(configPath)).toBe(true);

      // Double-check the file content
      const fileContent = require('fs').readFileSync(configPath, 'utf8');
      expect(fileContent).toContain('empty-env-var-test');

      // Clear require cache for this specific file
      const absoluteConfigPath = require('path').resolve(configPath);
      delete require.cache[absoluteConfigPath];

      // Set environment variable to empty string (which should be treated as not set)
      process.env.TRACEROOT_CONFIG_PATH = '';

      const loadedConfig = tryJavaScriptFallback();

      // Should fall back to directory search and load our config
      expect(loadedConfig).not.toBeNull();

      // Use a more specific assertion to help debug
      if (loadedConfig?.service_name !== 'empty-env-var-test') {
        console.log('Expected service_name: empty-env-var-test');
        console.log('Actual service_name:', loadedConfig?.service_name);
        console.log('Current working directory:', process.cwd());
        console.log('Config file exists:', existsSync(configPath));
        console.log('Files in test directory:', require('fs').readdirSync(testDir));
      }

      expect(loadedConfig?.service_name).toBe('empty-env-var-test');
      expect(loadedConfig?.token).toBe('empty-env-token');
      expect(loadedConfig?.github_owner).toBe('empty-env-org');
    });
  });
});
