/**
 * Tests for cloud logging when enable_log_cloud_export is true/false
 */

import { TraceRootConfigImpl } from '../../src/config';
import { initializeLogger, shutdownLogger, forceFlushLogger } from '../../src/logger';

// Mock the AWS credential fetching
jest.mock('../../src/api/credential', () => ({
  fetchAwsCredentialsSync: jest.fn(() => null),
}));

afterEach(async () => {
  await shutdownLogger();
  jest.clearAllMocks();
});

describe('Cloud Export Logging', () => {
  test('should not setup CloudWatch transport when enable_log_cloud_export is false', () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_cloud_export: false,
      local_mode: false,
    });

    const logger = initializeLogger(config);

    // Check that CloudWatch transport is not created
    const winstonLogger = (logger as any).logger;
    const cloudWatchTransports = winstonLogger.transports.filter(
      (transport: any) => transport.constructor.name === 'WinstonCloudWatch'
    );
    expect(cloudWatchTransports).toHaveLength(0);

    // Test logging - should not throw and not call AWS credential functions
    expect(async () => {
      await logger.info('Test cloud export disabled message');
    }).not.toThrow();
  });

  test('should not call fetchAwsCredentialsSync when enable_log_cloud_export is false', () => {
    const { fetchAwsCredentialsSync } = require('../../src/api/credential');

    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_cloud_export: false,
      local_mode: false,
      token: 'test-token',
    });

    initializeLogger(config);

    // fetchAwsCredentialsSync should not be called during tracer initialization
    // since we're testing in the context where it would be called from tracer
    // Let's check it's not called during logger operations
    expect(fetchAwsCredentialsSync).not.toHaveBeenCalled();
  });

  test('should not call checkAndRefreshCredentials when enable_log_cloud_export is false', async () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_cloud_export: false,
      local_mode: false,
      token: 'test-token',
    });

    const logger = initializeLogger(config);

    // Mock the private checkAndRefreshCredentials method to spy on it
    const checkAndRefreshCredentialsSpy = jest.spyOn(logger as any, 'checkAndRefreshCredentials');

    // Test various logging levels
    await logger.debug('Test debug message');
    await logger.info('Test info message');
    await logger.warn('Test warn message');
    await logger.error('Test error message');
    await logger.critical('Test critical message');

    // checkAndRefreshCredentials should not be called when cloud export is disabled
    expect(checkAndRefreshCredentialsSpy).not.toHaveBeenCalled();
  });

  test('should setup CloudWatch transport when enable_log_cloud_export is true and credentials are available', () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      // enable_log_cloud_export defaults to true
      local_mode: false,
      token: 'test-token',
    });

    // Manually set credentials to simulate tracer initialization
    (config as any)._awsCredentials = {
      aws_access_key_id: 'test-key',
      aws_secret_access_key: 'test-secret',
      aws_session_token: 'test-token',
      region: 'us-west-2',
      otlp_endpoint: 'http://test-endpoint',
      hash: 'test-hash',
      expiration_utc: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
    };

    const logger = initializeLogger(config);

    // Check that CloudWatch transport is created
    const winstonLogger = (logger as any).logger;
    const cloudWatchTransports = winstonLogger.transports.filter(
      (transport: any) => transport.constructor.name === 'WinstonCloudWatch'
    );
    expect(cloudWatchTransports).toHaveLength(1);
  });

  test('should work with console export enabled and cloud export disabled', async () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: true,
      enable_log_cloud_export: false,
      local_mode: false,
    });

    const logger = initializeLogger(config);

    // Check that console logger is created but CloudWatch transport is not
    const consoleLogger = (logger as any).consoleLogger;
    expect(consoleLogger).toBeDefined();
    expect(consoleLogger).not.toBeNull();

    const winstonLogger = (logger as any).logger;
    const cloudWatchTransports = winstonLogger.transports.filter(
      (transport: any) => transport.constructor.name === 'WinstonCloudWatch'
    );
    expect(cloudWatchTransports).toHaveLength(0);

    // Test logging - should work for console but not attempt cloud logging
    await expect(logger.info('Test message with console enabled and cloud disabled')).resolves.not.toThrow();
  });

  test('should default enable_log_cloud_export to true when not specified', () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      // enable_log_cloud_export not specified - should default to true
    });

    expect(config.enable_log_cloud_export).toBe(true);
  });

  test('should respect explicitly set enable_log_cloud_export to false', () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_cloud_export: false,
    });

    expect(config.enable_log_cloud_export).toBe(false);
  });

  test('should handle forceFlushLogger gracefully when enable_log_cloud_export is false', async () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_cloud_export: false,
      local_mode: false,
    });

    const logger = initializeLogger(config);

    // Log some messages
    await logger.info('Test message 1');
    await logger.warn('Test message 2');
    await logger.error('Test message 3');

    // forceFlushLogger should complete successfully without errors
    await expect(forceFlushLogger()).resolves.not.toThrow();
  });

  test('should handle shutdownLogger gracefully when enable_log_cloud_export is false', async () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_cloud_export: false,
      local_mode: false,
    });

    const logger = initializeLogger(config);

    // Log some messages
    await logger.info('Test message 1');
    await logger.warn('Test message 2');
    await logger.error('Test message 3');

    // shutdownLogger should complete successfully without errors
    await expect(shutdownLogger()).resolves.not.toThrow();
  });

  test('should handle forceFlushLogger and shutdownLogger in local mode', async () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_cloud_export: false,
      local_mode: true,
    });

    const logger = initializeLogger(config);

    // Log some messages
    await logger.info('Test message 1');
    await logger.warn('Test message 2');
    await logger.error('Test message 3');

    // Both operations should complete successfully without errors
    await expect(forceFlushLogger()).resolves.not.toThrow();
    await expect(shutdownLogger()).resolves.not.toThrow();
  });

  test('should handle forceFlushLogger when no global logger exists', async () => {
    // Ensure no global logger is set
    await shutdownLogger();

    // forceFlushLogger should handle the case gracefully when no logger exists
    await expect(forceFlushLogger()).resolves.not.toThrow();
  });

  test('should handle multiple consecutive flush and shutdown calls when cloud export is disabled', async () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_cloud_export: false,
      local_mode: false,
    });

    const logger = initializeLogger(config);

    // Log some messages
    await logger.info('Test message 1');

    // Multiple flush calls should not cause issues
    await expect(forceFlushLogger()).resolves.not.toThrow();
    await expect(forceFlushLogger()).resolves.not.toThrow();
    await expect(forceFlushLogger()).resolves.not.toThrow();

    // Shutdown should work after multiple flushes
    await expect(shutdownLogger()).resolves.not.toThrow();

    // Additional shutdown calls should be handled gracefully
    await expect(shutdownLogger()).resolves.not.toThrow();
  });
});
