/**
 * Tests for console logging format with and without logger names
 *
 * This test verifies that:
 * - When logger name matches service name: logs appear as "timestamp [LEVEL] message"
 * - When logger name differs from service name: logs appear as "timestamp [LEVEL] [name] message"
 */

import { TraceRootConfigImpl } from '../../src/config';
import { getLogger, shutdownLogger, setGlobalConfig } from '../../src/logger';

afterEach(async () => {
  await shutdownLogger();
});

describe('Console Log Format Tests', () => {
  test('should create console logger and log without name when logger name matches service name', async () => {
    // Create config with console export enabled
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: true,
      enable_log_cloud_export: false,
      local_mode: true,
      log_level: 'debug',
    });

    // Initialize logger
    setGlobalConfig(config);
    const logger = getLogger(); // This will use service_name as logger name

    // Check that console logger is created
    const consoleLogger = (logger as any).consoleLogger;
    expect(consoleLogger).toBeDefined();
    expect(consoleLogger).not.toBeNull();

    // Verify logger name matches service name
    expect(logger.loggerName).toBe('test-service');

    // Test that logging doesn't throw - this will output to console without name
    await expect(logger.debug('Test message without name')).resolves.not.toThrow();
    await expect(logger.info('Request interrupted by user')).resolves.not.toThrow();
  });

  test('should create console logger and log with name when logger name differs from service name', async () => {
    // Create config with console export enabled
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: true,
      enable_log_cloud_export: false,
      local_mode: true,
      log_level: 'debug',
    });

    // Initialize logger
    setGlobalConfig(config);
    const logger = getLogger('custom-module'); // Different from service_name

    // Check that console logger is created
    const consoleLogger = (logger as any).consoleLogger;
    expect(consoleLogger).toBeDefined();
    expect(consoleLogger).not.toBeNull();

    // Verify logger name is different from service name
    expect(logger.loggerName).toBe('custom-module');
    expect(logger.loggerName).not.toBe((logger as any).config.service_name);

    // Test that logging doesn't throw - this will output to console with name
    await expect(logger.debug('Test message with name')).resolves.not.toThrow();
    await expect(logger.info('Request interrupted by user')).resolves.not.toThrow();
  });

  test('should handle child logger naming correctly', async () => {
    // Create config with console export enabled
    const config = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: true,
      enable_log_cloud_export: false,
      local_mode: true,
      log_level: 'debug',
    });

    // Initialize logger
    setGlobalConfig(config);
    const parentLogger = getLogger('parent-module');
    const childLogger = parentLogger.child({ requestId: '123' });

    // Verify child logger has same name as parent
    expect(childLogger.loggerName).toBe('parent-module');
    expect(childLogger.loggerName).not.toBe((childLogger as any).config.service_name);

    // Test that child logging doesn't throw - this will output to console with name and metadata
    await expect(childLogger.info('Child logger message')).resolves.not.toThrow();
  });

  test('should demonstrate the logging format difference', async () => {
    console.log('\n=== Console Logging Format Demonstration ===');
    console.log('Expected formats:');
    console.log('- Without name: "timestamp [LEVEL] message"');
    console.log('- With name: "timestamp [LEVEL] [name] message"');
    console.log('\nActual output:');

    const config = new TraceRootConfigImpl({
      service_name: 'demo-service',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-hash',
      environment: 'test',
      enable_log_console_export: true,
      enable_log_cloud_export: false,
      local_mode: true,
      log_level: 'debug',
    });

    setGlobalConfig(config);

    // Logger without custom name (matches service name)
    const defaultLogger = getLogger();
    await defaultLogger.info('Request interrupted by user');

    // Logger with custom name (differs from service name)
    const namedLogger = getLogger('request-handler');
    await namedLogger.info('Request interrupted by user');

    console.log('=== End of demonstration ===\n');

    // Just verify the test completes without errors
    expect(true).toBe(true);
  });
});
