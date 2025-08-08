/**
 * Test suite for JavaScript configuration file loading
 *
 * This test focuses on the JavaScript config loading fallback mechanism
 * when TypeScript configs are not available or fail to load.
 */

import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  findTypescriptConfig,
  loadTypescriptConfigSync
} from '../src/utils/configLoader';

// Mock modules to avoid side effects
jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn(),
}));

jest.mock('winston-cloudwatch', () => jest.fn());

describe('JavaScript Configuration Loading', () => {
  const testDir = join(process.cwd(), 'test-configs-js');
  const originalCwd = process.cwd();

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
    // Change to test directory
    process.chdir(testDir);
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up test files and restore cwd
    const configFiles = [
      'traceroot.config.ts',
      'traceroot.config.js',
      'traceroot.config.mjs',
      'traceroot.config.cjs'
    ];

    configFiles.forEach(file => {
      const filePath = join(testDir, file);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        // Clear require cache for this file
        delete require.cache[filePath];
      }
    });

    // Clear all require cache to avoid test interference
    Object.keys(require.cache).forEach(key => {
      if (key.includes('test-configs-js')) {
        delete require.cache[key];
      }
    });

    process.chdir(originalCwd);
    jest.restoreAllMocks();
  });

  describe('findTypescriptConfig Priority', () => {
    test('should prioritize TypeScript config when available', () => {
      // Create both TypeScript and JavaScript configs
      const tsConfig = `export default { service_name: 'ts-test' };`;
      const jsConfig = `module.exports = { service_name: 'js-test' };`;

      writeFileSync(join(testDir, 'traceroot.config.ts'), tsConfig);
      writeFileSync(join(testDir, 'traceroot.config.js'), jsConfig);

      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBe(join(testDir, 'traceroot.config.ts'));
    });

    test('should fall back to JavaScript config when TypeScript not available', () => {
      const jsConfig = `module.exports = { service_name: 'js-test' };`;
      writeFileSync(join(testDir, 'traceroot.config.js'), jsConfig);

      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBe(join(testDir, 'traceroot.config.js'));
    });

    test('should return null when no config files exist', () => {
      const foundConfig = findTypescriptConfig();
      expect(foundConfig).toBeNull();
    });
  });

  describe('JavaScript Config Loading', () => {
    test('should successfully load basic JavaScript config', () => {
      const jsConfig = `
const config = {
  service_name: 'js-example',
  github_owner: 'traceroot-ai',
  github_repo_name: 'traceroot-sdk',
  github_commit_hash: 'main',
  environment: 'development',
  token: 'traceroot-test-token',
  enable_span_console_export: false,
  enable_log_console_export: true,
  local_mode: false
};

module.exports = config;
`;

      const configPath = join(testDir, 'test1.config.js');
      writeFileSync(configPath, jsConfig);

      const loadedConfig = loadTypescriptConfigSync(configPath);

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('js-example');
      expect(loadedConfig?.github_owner).toBe('traceroot-ai');
      expect(loadedConfig?.environment).toBe('development');
      expect(loadedConfig?.enable_log_console_export).toBe(true);
    });

    test('should handle config exported as default property', () => {
      const jsConfig = `
const config = {
  service_name: 'default-export-test',
  github_owner: 'test-owner',
  github_repo_name: 'test-repo',
  github_commit_hash: 'main',
  environment: 'test'
};

module.exports = { default: config };
`;

      const configPath = join(testDir, 'test2.config.js');
      writeFileSync(configPath, jsConfig);

      const loadedConfig = loadTypescriptConfigSync(configPath);

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('default-export-test');
    });

    test('should handle config exported as function', () => {
      const jsConfig = `
function createConfig() {
  return {
    service_name: 'function-config-test',
    github_owner: 'test-owner',
    github_repo_name: 'test-repo',
    github_commit_hash: 'main',
    environment: 'test'
  };
}

module.exports = createConfig;
`;

      const configPath = join(testDir, 'test3.config.js');
      writeFileSync(configPath, jsConfig);

      const loadedConfig = loadTypescriptConfigSync(configPath);

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('function-config-test');
    });
  });

  describe('TypeScript to JavaScript Fallback', () => {
    test('should fall back to JavaScript when TypeScript compilation fails', () => {
      // Create a working JavaScript fallback
      const jsConfig = `
const config = {
  service_name: 'js-fallback-test',
  github_owner: 'test-owner',
  github_repo_name: 'test-repo',
  github_commit_hash: 'main',
  environment: 'test'
};

module.exports = config;
`;

      writeFileSync(join(testDir, 'traceroot.config.js'), jsConfig);

      // Create a TypeScript config with severe compilation errors
      const invalidTsConfig = `
// This TypeScript code has syntax errors that will cause compilation to fail
interface Config {
  service_name: string
  // Missing semicolon and invalid syntax
  $$INVALID_SYNTAX_HERE$$
  github_owner: unknown_type_that_does_not_exist
}

const config: Config = {
  service_name: 'ts-should-fail',
  // This will cause compilation errors
  invalid_property_that_breaks_compilation: () => { INVALID_CODE_HERE
  github_owner: undefined as unknown_type,
  github_repo_name: 'test-repo',
  github_commit_hash: 'main',
  environment: 'test'
};

// Invalid export syntax
export default config as InvalidTypeNameThatDoesNotExist;
`;

      const tsConfigPath = join(testDir, 'traceroot.config.ts');
      writeFileSync(tsConfigPath, invalidTsConfig);

      const loadedConfig = loadTypescriptConfigSync(tsConfigPath);

      // Should have fallen back to JavaScript config due to TypeScript compilation failure
      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('js-fallback-test');
    });
  });

  describe('Error Handling', () => {
    test('should return null for non-existent config file', () => {
      const nonExistentPath = join(testDir, 'non-existent.config.js');
      const loadedConfig = loadTypescriptConfigSync(nonExistentPath);

      expect(loadedConfig).toBeNull();
    });

    test('should handle invalid JavaScript syntax gracefully', () => {
      const invalidJsConfig = `
const config = {
  service_name: 'invalid-test'
  // Missing comma - this will cause syntax error
  github_owner: 'test-owner'
`;

      const configPath = join(testDir, 'invalid.config.js');
      writeFileSync(configPath, invalidJsConfig);

      const loadedConfig = loadTypescriptConfigSync(configPath);

      expect(loadedConfig).toBeNull();
    });
  });

  describe('Manual Module Compilation', () => {
    test('should use manual compilation as fallback', () => {
      const jsConfig = `
const config = {
  service_name: 'manual-test',
  github_owner: 'test-owner',
  github_repo_name: 'test-repo',
  github_commit_hash: 'main',
  environment: 'test'
};

module.exports = config;
`;

      const configPath = join(testDir, 'manual.config.js');
      writeFileSync(configPath, jsConfig);

      // Test that our manual compilation works
      const loadedConfig = loadTypescriptConfigSync(configPath);

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('manual-test');
    });
  });

  describe('Manual TypeScript Compilation', () => {
    test('should compile and load TypeScript config manually when ts-node fails', () => {
      // Create a TypeScript config that would normally require ts-node
      const tsConfig = `
interface TraceRootConfig {
  service_name: string;
  github_owner: string;
  github_repo_name: string;
  github_commit_hash: string;
  environment: string;
  token?: string;
  enable_span_console_export?: boolean;
  enable_log_console_export?: boolean;
  local_mode?: boolean;
}

const config: TraceRootConfig = {
  service_name: 'manual-ts-test',
  github_owner: 'traceroot-ai',
  github_repo_name: 'traceroot-sdk-ts',
  github_commit_hash: 'main',
  environment: process.env.NODE_ENV || 'development',
  token: 'test-token-123',
  enable_span_console_export: false,
  enable_log_console_export: true,
  local_mode: false,
};

export default config;
`;

      const configPath = join(testDir, 'manual-ts.config.ts');
      writeFileSync(configPath, tsConfig);

      const loadedConfig = loadTypescriptConfigSync(configPath);

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('manual-ts-test');
      expect(loadedConfig?.github_owner).toBe('traceroot-ai');
      expect(loadedConfig?.enable_log_console_export).toBe(true);
    });

    test('should handle TypeScript compilation errors gracefully', () => {
      // Create a TypeScript config with syntax errors
      const invalidTsConfig = `
interface Config {
  service_name: string
  // Missing semicolon and other syntax issues
  invalid syntax here!!!
}

const config: Config = {
  service_name: 'invalid-ts-test'
  // Missing comma
  github_owner: 'test'
`;

      const configPath = join(testDir, 'invalid-ts.config.ts');
      writeFileSync(configPath, invalidTsConfig);

      const loadedConfig = loadTypescriptConfigSync(configPath);

      // Should fall back gracefully and return null since there's no JS fallback
      expect(loadedConfig).toBeNull();
    });
  });

  describe('Real-world JavaScript Config', () => {
    test('should load config matching the user example', () => {
      // This matches the actual config structure from the user's example
      const realWorldConfig = `
const config = {
  // Basic service configuration
  service_name: 'js-example',
  github_owner: 'traceroot-ai',
  github_repo_name: 'traceroot-sdk',
  github_commit_hash: 'main',

  // Your environment configuration
  // development, staging, production
  environment: 'development',

  // Token configuration
  token: 'traceroot-5724dd0ee3574060b7d0f3730694f44d',

  // Whether to enable console export of spans and logs
  enable_span_console_export: false,
  enable_log_console_export: true,

  // Local mode that whether to store all data locally
  local_mode: false,
};

module.exports = config;
`;

      const configPath = join(testDir, 'realworld.config.js');
      writeFileSync(configPath, realWorldConfig);

      const loadedConfig = loadTypescriptConfigSync(configPath);

      expect(loadedConfig).not.toBeNull();
      expect(loadedConfig?.service_name).toBe('js-example');
      expect(loadedConfig?.github_owner).toBe('traceroot-ai');
      expect(loadedConfig?.github_repo_name).toBe('traceroot-sdk');
      expect(loadedConfig?.github_commit_hash).toBe('main');
      expect(loadedConfig?.environment).toBe('development');
      expect(loadedConfig?.token).toBe('traceroot-5724dd0ee3574060b7d0f3730694f44d');
      expect(loadedConfig?.enable_span_console_export).toBe(false);
      expect(loadedConfig?.enable_log_console_export).toBe(true);
      expect(loadedConfig?.local_mode).toBe(false);
    });
  });
});
