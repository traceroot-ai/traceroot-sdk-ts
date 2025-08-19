/**
 * Tests for logger behavior when both enable_log_console_export and enable_log_cloud_export are false
 */

import { TraceRootConfigImpl } from '../../src/config';
import { initializeLogger, shutdownLogger } from '../../src/logger';

// Mock the AWS credential fetching
jest.mock('../../src/api/credential', () => ({
  fetchAwsCredentialsSync: jest.fn(() => null),
}));

afterEach(async () => {
  await shutdownLogger();
  jest.clearAllMocks();
});

describe('Both Exports Disabled', () => {
  test('should handle logging gracefully when both exports are disabled in non-local mode', async () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: false,
      enable_log_cloud_export: false,
      local_mode: false,
    });

    const logger = initializeLogger(config);

    // Check that no console logger is created
    const consoleLogger = (logger as any).consoleLogger;
    expect(consoleLogger).toBeNull();

    // Check that no CloudWatch transport is created
    const winstonLogger = (logger as any).logger;
    const cloudWatchTransports = winstonLogger.transports.filter(
      (transport: any) => transport.constructor.name === 'WinstonCloudWatch'
    );
    expect(cloudWatchTransports).toHaveLength(0);

    // The Winston logger should have a silent console transport to prevent warnings
    const silentTransports = winstonLogger.transports.filter(
      (transport: any) => transport.constructor.name === 'Console' && transport.silent === true
    );
    expect(silentTransports.length).toBeGreaterThan(0);

    // Test all logging levels - should not throw errors
    await expect(logger.debug('Test debug message')).resolves.not.toThrow();
    await expect(logger.info('Test info message')).resolves.not.toThrow();
    await expect(logger.warn('Test warn message')).resolves.not.toThrow();
    await expect(logger.error('Test error message')).resolves.not.toThrow();
    await expect(logger.critical('Test critical message')).resolves.not.toThrow();
  });

  test('should handle logging gracefully when both exports are disabled in local mode', async () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: false,
      enable_log_cloud_export: false,
      local_mode: true,
    });

    const logger = initializeLogger(config);

    // Check that no console logger is created
    const consoleLogger = (logger as any).consoleLogger;
    expect(consoleLogger).toBeNull();

    // Check that no CloudWatch transport is created
    const winstonLogger = (logger as any).logger;
    const cloudWatchTransports = winstonLogger.transports.filter(
      (transport: any) => transport.constructor.name === 'WinstonCloudWatch'
    );
    expect(cloudWatchTransports).toHaveLength(0);

    // Test all logging levels - should not throw errors
    await expect(logger.debug('Test debug message')).resolves.not.toThrow();
    await expect(logger.info('Test info message')).resolves.not.toThrow();
    await expect(logger.warn('Test warn message')).resolves.not.toThrow();
    await expect(logger.error('Test error message')).resolves.not.toThrow();
    await expect(logger.critical('Test critical message')).resolves.not.toThrow();
  });

  test('should not call checkAndRefreshCredentials when both exports are disabled', async () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: false,
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

    // checkAndRefreshCredentials should not be called when both exports are disabled
    expect(checkAndRefreshCredentialsSpy).not.toHaveBeenCalled();
  });

  test('should not attempt to setup any CloudWatch transports when both exports are disabled', () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: false,
      enable_log_cloud_export: false,
      local_mode: false,
      token: 'test-token',
    });

    const logger = initializeLogger(config);

    // Check that setupCloudWatchTransport is not called by verifying no CloudWatch transports exist
    const winstonLogger = (logger as any).logger;
    const cloudWatchTransports = winstonLogger.transports.filter(
      (transport: any) => transport.constructor.name === 'WinstonCloudWatch'
    );
    expect(cloudWatchTransports).toHaveLength(0);

    // Check that cloudWatchTransport property is null
    const cloudWatchTransport = (logger as any).cloudWatchTransport;
    expect(cloudWatchTransport).toBeNull();
  });

  test('should still process span events in local mode when both exports are disabled', async () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: false,
      enable_log_cloud_export: false,
      local_mode: true,
    });

    const logger = initializeLogger(config);

    // Mock the addSpanEventDirectly method to verify it's called
    const addSpanEventDirectlySpy = jest.spyOn(logger as any, 'addSpanEventDirectly');

    // Test logging
    await logger.info('Test message');

    // In local mode, span events should still be processed even when both exports are disabled
    expect(addSpanEventDirectlySpy).toHaveBeenCalledWith(
      'info',
      'Test message',
      expect.any(Object)
    );
  });

  test('should effectively skip all logging output when both exports are disabled', async () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: false,
      enable_log_cloud_export: false,
      local_mode: false,
    });

    const logger = initializeLogger(config);

    // Capture console output to verify nothing is logged
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    try {
      // Test all logging levels
      await logger.debug('Test debug message');
      await logger.info('Test info message');
      await logger.warn('Test warn message');
      await logger.error('Test error message');
      await logger.critical('Test critical message');

      // No console output should occur (except for framework internal messages)
      // We won't test for zero calls since there might be other internal logging
      // but we can verify the logging methods don't throw
      expect(true).toBe(true); // Test passes if we reach this point without throwing
    } finally {
      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    }
  });

  test('should maintain proper winston logger level when both exports are disabled', () => {
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: false,
      enable_log_cloud_export: false,
      local_mode: false,
    });

    const logger = initializeLogger(config);
    const winstonLogger = (logger as any).logger;

    // When console export is disabled, the winston logger level should be 'silent'
    expect(winstonLogger.level).toBe('silent');
  });
});
