/**
 * Tests for console logging when enable_log_console_export is true
 */

import { TraceRootConfigImpl } from '../../src/config';
import { initializeLogger, shutdownLogger } from '../../src/logger';

afterEach(async () => {
  await shutdownLogger();
});

describe('Console Export Logging', () => {
  test('should create console logger when enable_log_console_export is true (sync)', () => {
    // Create config with console export enabled
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: true,
      local_mode: false,
    });

    // Initialize logger
    const logger = initializeLogger(config);

    // Check that console logger is created (access private property for testing)
    const consoleLogger = (logger as any).consoleLogger;
    expect(consoleLogger).toBeDefined();
    expect(consoleLogger).not.toBeNull();

    // Test sync logging - should not throw
    expect(() => {
      logger.info('Test sync console message');
    }).not.toThrow();
  });

  test('should create console logger when enable_log_console_export is true (async)', async () => {
    // Create config with console export enabled
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: true,
      local_mode: false,
    });

    // Initialize logger
    const logger = initializeLogger(config);

    // Check that console logger is created
    const consoleLogger = (logger as any).consoleLogger;
    expect(consoleLogger).toBeDefined();
    expect(consoleLogger).not.toBeNull();

    // Test async logging - should not throw
    await expect(logger.info('Test async console message')).resolves.not.toThrow();
  });

  test('should handle user metadata in console logs', async () => {
    // Create config with console export enabled
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: true,
      local_mode: false,
    });

    // Initialize logger
    const logger = initializeLogger(config);

    // Check that console logger is created
    const consoleLogger = (logger as any).consoleLogger;
    expect(consoleLogger).toBeDefined();

    // Test logging with metadata - should not throw
    const userMetadata = { userId: 123, action: 'login' };
    await expect(logger.info(userMetadata, 'Test message with metadata')).resolves.not.toThrow();
  });

  test('should NOT create console logger when enable_log_console_export is false', () => {
    // Create config with console export disabled
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: false, // Disabled
      local_mode: false,
    });

    // Initialize logger
    const logger = initializeLogger(config);

    // Check that console logger is NOT created
    const consoleLogger = (logger as any).consoleLogger;
    expect(consoleLogger).toBeNull();
  });

  test('should work with all log levels', async () => {
    // Create config with console export enabled
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: true,
      local_mode: false,
    });

    // Initialize logger
    const logger = initializeLogger(config);

    // Check that console logger is created
    const consoleLogger = (logger as any).consoleLogger;
    expect(consoleLogger).toBeDefined();

    // Test all log levels - should not throw
    await expect(logger.debug('Debug message')).resolves.not.toThrow();
    await expect(logger.info('Info message')).resolves.not.toThrow();
    await expect(logger.warn('Warn message')).resolves.not.toThrow();
    await expect(logger.error('Error message')).resolves.not.toThrow();
    await expect(logger.critical('Critical message')).resolves.not.toThrow();
  });
});
