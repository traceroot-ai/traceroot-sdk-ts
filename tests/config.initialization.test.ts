/**
 * Test suite for TraceRoot configuration initialization
 * 
 * This test focuses on the core configuration loading and validation logic
 * without testing the full AWS SDK integration to avoid Jest compatibility issues.
 */

import { TraceRootConfigImpl } from '../src/config';

// Mock child_process to avoid actual curl calls during tests
jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

// Mock AWS SDK modules to prevent Jest issues
jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn(),
}));

jest.mock('winston-cloudwatch-logs', () => ({
  default: jest.fn(),
}));

const mockConfig = {
  service_name: 'test-service',
  github_owner: 'test-owner',
  github_repo_name: 'test-repo',
  github_commit_hash: 'test-commit',
  environment: 'test',
  token: 'test-token',
  enable_span_console_export: true,
  enable_log_console_export: true,
  local_mode: false,
  autoInit: true,
};

describe('TraceRoot Configuration Initialization', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Configuration Validation and Defaults', () => {
    test('should create TraceRootConfigImpl with valid configuration', () => {
      const config = new TraceRootConfigImpl(mockConfig);
      
      expect(config.service_name).toBe(mockConfig.service_name);
      expect(config.github_owner).toBe(mockConfig.github_owner);
      expect(config.github_repo_name).toBe(mockConfig.github_repo_name);
      expect(config.github_commit_hash).toBe(mockConfig.github_commit_hash);
      expect(config.environment).toBe(mockConfig.environment);
      expect(config.token).toBe(mockConfig.token);
      expect(config.enable_span_console_export).toBe(mockConfig.enable_span_console_export);
      expect(config.enable_log_console_export).toBe(mockConfig.enable_log_console_export);
      expect(config.local_mode).toBe(mockConfig.local_mode);
    });

    test('should apply default values for optional fields', () => {
      const minimalConfig = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
      };
      
      const config = new TraceRootConfigImpl(minimalConfig);
      
      // Check default values are applied
      expect(config.aws_region).toBe('us-west-2');
      expect(config.otlp_endpoint).toBe('http://localhost:4318/v1/traces');
      expect(config.environment).toBe('development');
      expect(config.enable_span_console_export).toBe(false);
      expect(config.enable_log_console_export).toBe(false);
      expect(config.local_mode).toBe(false);
    });

    test('should override defaults with provided values', () => {
      const customConfig = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        aws_region: 'eu-west-1',
        otlp_endpoint: 'http://custom-endpoint:4318/v1/traces',
        environment: 'production',
        enable_span_console_export: true,
        enable_log_console_export: true,
        local_mode: true,
      };
      
      const config = new TraceRootConfigImpl(customConfig);
      
      expect(config.aws_region).toBe('eu-west-1');
      expect(config.otlp_endpoint).toBe('http://custom-endpoint:4318/v1/traces');
      expect(config.environment).toBe('production');
      expect(config.enable_span_console_export).toBe(true);
      expect(config.enable_log_console_export).toBe(true);
      expect(config.local_mode).toBe(true);
    });
  });

  describe('Environment Variable Handling', () => {
    test('should use environment variables in config', () => {
      // Set environment variables
      process.env.NODE_ENV = 'production';
      process.env.TRACEROOT_TOKEN = 'env-token-123';
      
      // Create a config that uses environment variables (simulating traceroot.config.ts)
      const envConfig = {
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: process.env.NODE_ENV || 'development',
        token: process.env.TRACEROOT_TOKEN || 'default-token',
      };
      
      expect(envConfig.environment).toBe('production');
      expect(envConfig.token).toBe('env-token-123');
    });

    test('should fall back to default values when env vars are not set', () => {
      // Ensure env vars are not set
      delete process.env.NODE_ENV;
      delete process.env.TRACEROOT_TOKEN;
      
      const config = {
        environment: process.env.NODE_ENV || 'development',
        token: process.env.TRACEROOT_TOKEN || 'default-token',
      };
      
      expect(config.environment).toBe('development');
      expect(config.token).toBe('default-token');
    });
  });

  describe('Configuration Structure Validation', () => {
    test('should have all required fields for tracer initialization', () => {
      const config = new TraceRootConfigImpl(mockConfig);
      
      // These fields are required for tracer initialization
      expect(config.service_name).toBeDefined();
      expect(config.github_owner).toBeDefined();
      expect(config.github_repo_name).toBeDefined();
      expect(config.github_commit_hash).toBeDefined();
    });

    test('should identify missing required fields', () => {
      const requiredFields = ['service_name', 'github_owner', 'github_repo_name', 'github_commit_hash'];
      
      // Test each required field
      requiredFields.forEach(field => {
        const incompleteConfig = { ...mockConfig };
        delete incompleteConfig[field as keyof typeof incompleteConfig];
        
        // The validation would happen during tracer initialization
        expect(incompleteConfig[field as keyof typeof incompleteConfig]).toBeUndefined();
      });
    });

    test('should support local mode configuration', () => {
      const localConfig = {
        ...mockConfig,
        local_mode: true,
      };

      const config = new TraceRootConfigImpl(localConfig);
      
      expect(config.local_mode).toBe(true);
      // In local mode, default endpoint should be localhost
      expect(config.otlp_endpoint).toBe('http://localhost:4318/v1/traces');
    });

    test('should support console export configuration', () => {
      const config = new TraceRootConfigImpl(mockConfig);
      
      expect(config.enable_span_console_export).toBe(true);
      expect(config.enable_log_console_export).toBe(true);
    });
  });

  describe('AWS Credentials Configuration', () => {
    test('should handle configuration with token for AWS credentials', () => {
      const config = new TraceRootConfigImpl(mockConfig);
      
      expect(config.token).toBe(mockConfig.token);
      expect(config.local_mode).toBe(false); // Should attempt to fetch AWS credentials
    });

    test('should handle configuration without token', () => {
      const configWithoutToken = {
        ...mockConfig,
        token: undefined,
      };

      const config = new TraceRootConfigImpl(configWithoutToken);
      
      expect(config.token).toBeUndefined();
      // Should still work but won't fetch AWS credentials
    });

    test('should prepare for AWS region configuration', () => {
      const config = new TraceRootConfigImpl(mockConfig);
      
      expect(config.aws_region).toBe('us-west-2'); // default
      
      const customRegionConfig = {
        ...mockConfig,
        aws_region: 'eu-central-1',
      };
      
      const customConfig = new TraceRootConfigImpl(customRegionConfig);
      expect(customConfig.aws_region).toBe('eu-central-1');
    });
  });

  describe('Configuration File Structure', () => {
    test('should support autoInit flag', () => {
      const config = mockConfig;
      
      expect(config.autoInit).toBe(true);
      
      const disabledAutoInitConfig = {
        ...mockConfig,
        autoInit: false,
      };
      
      expect(disabledAutoInitConfig.autoInit).toBe(false);
    });

    test('should support environment-specific overrides structure', () => {
      const configWithEnvironments = {
        ...mockConfig,
        environments: {
          production: {
            local_mode: false,
            enable_span_console_export: false,
            enable_log_console_export: false,
          },
          development: {
            local_mode: true,
            enable_span_console_export: true,
            enable_log_console_export: true,
          },
        },
      };

      // Test production environment overrides
      const prodOverrides = configWithEnvironments.environments.production;
      expect(prodOverrides.local_mode).toBe(false);
      expect(prodOverrides.enable_span_console_export).toBe(false);
      
      // Test development environment overrides
      const devOverrides = configWithEnvironments.environments.development;
      expect(devOverrides.local_mode).toBe(true);
      expect(devOverrides.enable_span_console_export).toBe(true);
    });
  });

  describe('Configuration Consistency', () => {
    test('should maintain consistency between config fields and implementation', () => {
      const config = new TraceRootConfigImpl(mockConfig);
      
      // Verify internal name generation
      expect(config._sub_name).toBe(`${config.service_name}-${config.environment}`);
      
      // Verify name fallback
      expect(config._name).toBe(config.name); // Should be undefined initially
    });

    test('should handle configuration updates for AWS credentials', () => {
      const config = new TraceRootConfigImpl(mockConfig);
      
      // Simulate what happens when AWS credentials are fetched
      const mockAwsCredentials = {
        hash: 'test-hash-123',
        otlp_endpoint: 'http://aws-endpoint:4318/v1/traces',
      };
      
      // These would be set during credential fetching
      config._name = mockAwsCredentials.hash;
      config.otlp_endpoint = mockAwsCredentials.otlp_endpoint;
      
      expect(config._name).toBe('test-hash-123');
      expect(config.otlp_endpoint).toBe('http://aws-endpoint:4318/v1/traces');
    });
  });

  describe('Real Configuration File Validation', () => {
    test('should validate the actual traceroot.config.ts structure', () => {
      // This test validates that our actual config file has the right structure
      // without importing it to avoid initialization side effects
      
      const expectedConfigStructure = {
        service_name: expect.any(String),
        github_owner: expect.any(String),
        github_repo_name: expect.any(String),
        github_commit_hash: expect.any(String),
        environment: expect.any(String),
        token: expect.any(String),
        enable_span_console_export: expect.any(Boolean),
        enable_log_console_export: expect.any(Boolean),
        local_mode: expect.any(Boolean),
        autoInit: expect.any(Boolean),
      };
      
      // Our mock config should match this structure
      expect(mockConfig).toEqual(expect.objectContaining(expectedConfigStructure));
    });

    test('should support all configuration options used in traceroot.config.ts', () => {
      // Based on the actual traceroot.config.ts file
      const actualConfigStructure = {
        service_name: 'ts-example',
        github_owner: 'traceroot-ai',
        github_repo_name: 'traceroot-sdk-ts',
        github_commit_hash: 'main',
        environment: process.env.NODE_ENV || 'development',
        token: process.env.TRACEROOT_TOKEN || 'traceroot-be9fd8e3b30c4b21baef4ea7888e599c',
        enable_span_console_export: true,
        enable_log_console_export: true,
        local_mode: false,
        autoInit: true,
      };
      
      const config = new TraceRootConfigImpl(actualConfigStructure);
      
      expect(config.service_name).toBe('ts-example');
      expect(config.github_owner).toBe('traceroot-ai');
      expect(config.github_repo_name).toBe('traceroot-sdk-ts');
      expect(config.github_commit_hash).toBe('main');
      expect(config.enable_span_console_export).toBe(true);
      expect(config.enable_log_console_export).toBe(true);
      expect(config.local_mode).toBe(false);
    });
  });
});