import { getLogger, shutdownLogger, setGlobalConfig } from '../../src/logger';
import { TraceRootConfigImpl } from '../../src/config';
import * as credential from '../../src/api/credential';

// Mock winston and related dependencies
jest.mock('winston', () => {
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    add: jest.fn(),
    on: jest.fn(),
    remove: jest.fn(),
    transports: [], // Add transports array for flush method
  };

  const formatMock: any = jest.fn(fn => {
    return (info: any) => {
      if (info && typeof info === 'object') {
        return fn(info);
      }
      return info;
    };
  });
  formatMock.combine = jest.fn(() => formatMock);
  formatMock.timestamp = jest.fn(() => formatMock);
  formatMock.errors = jest.fn(() => formatMock);
  formatMock.json = jest.fn(() => formatMock);
  formatMock.colorize = jest.fn(() => formatMock);
  formatMock.printf = jest.fn(() => formatMock);

  const winston = {
    createLogger: jest.fn(() => mockLogger),
    format: formatMock,
    transports: {
      Console: jest.fn(),
    },
  };

  return winston;
});

jest.mock('winston-cloudwatch', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    kthxbye: jest.fn(callback => callback()), // Mock flush method with immediate callback
  }));
});

jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn(),
  CreateLogGroupCommand: jest.fn(),
  CreateLogStreamCommand: jest.fn(),
  DescribeLogGroupsCommand: jest.fn(),
  DescribeLogStreamsCommand: jest.fn(),
}));

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: jest.fn(() => null),
  },
}));

// Mock fetch for credential validation
global.fetch = jest.fn();

describe('TraceRoot Logger with Invalid AWS Credentials', () => {
  let mockConfig: TraceRootConfigImpl;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Spy on console methods to capture error logs
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    mockConfig = {
      service_name: 'test-service',
      local_mode: false,
      enable_log_console_export: true,
      enable_log_cloud_export: true,
      enable_span_console_export: true,
      enable_span_cloud_export: true,
      github_commit_hash: 'abc123',
      github_owner: 'test-owner',
      github_repo_name: 'test-repo',
      environment: 'test',
      aws_region: 'us-east-1',
      otlp_endpoint: 'http://localhost:4318',
      log_level: 'debug',
      _name: 'test-logger',
      _sub_name: 'test-sub-logger',
      token: 'invalid-token',
    };
  });

  afterEach(async () => {
    await shutdownLogger();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  test('should NOT throw errors when AWS credential fetch fails during initialization', () => {
    // Mock fetchAwsCredentialsSync to return null (simulating credential fetch failure)
    const fetchSpy = jest.spyOn(credential, 'fetchAwsCredentialsSync').mockReturnValue(null);

    // Creating logger should NOT throw an error even with invalid credentials
    expect(() => {
      setGlobalConfig(mockConfig);
      const logger = getLogger();
      expect(logger).toBeDefined();
    }).not.toThrow();

    // Note: credential fetching happens in tracer initialization, not logger initialization
    // So we don't expect fetchAwsCredentialsSync to be called directly by the logger
    // The logger gets credentials from the config that was already set up by the tracer
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('should NOT throw errors when AWS credential refresh fails during logging', async () => {
    // Set up expired credentials
    const expiredCredentials = {
      aws_access_key_id: 'expired-access-key',
      aws_secret_access_key: 'expired-secret-key',
      aws_session_token: 'expired-session-token',
      region: 'us-east-1',
      hash: 'expired-hash',
      expiration_utc: new Date(Date.now() - 600000), // 10 minutes ago
      otlp_endpoint: 'http://localhost:4318',
    };

    (mockConfig as any)._awsCredentials = expiredCredentials;

    // Mock fetch to reject (simulating network error or invalid token)
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Unauthorized: Invalid token'));

    setGlobalConfig(mockConfig);
    const logger = getLogger();

    // Logging operations should NOT throw errors even when credential refresh fails
    await expect(logger.debug('Test debug message')).resolves.not.toThrow();
    await expect(logger.info('Test info message')).resolves.not.toThrow();
    await expect(logger.warn('Test warn message')).resolves.not.toThrow();
    await expect(logger.error('Test error message')).resolves.not.toThrow();
    await expect(logger.critical('Test critical message')).resolves.not.toThrow();

    // Verify that credential refresh was attempted
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test.traceroot.ai/v1/verify/credentials?token=invalid-token',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })
    );

    // Verify that errors were logged (not thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[TraceRoot] Failed to refresh AWS credentials:',
      'Unauthorized: Invalid token'
    );
  });

  test('should NOT throw errors when AWS credential refresh returns invalid response', async () => {
    // Set up expired credentials
    const expiredCredentials = {
      aws_access_key_id: 'expired-access-key',
      aws_secret_access_key: 'expired-secret-key',
      aws_session_token: 'expired-session-token',
      region: 'us-east-1',
      hash: 'expired-hash',
      expiration_utc: new Date(Date.now() - 600000), // 10 minutes ago
      otlp_endpoint: 'http://localhost:4318',
    };

    (mockConfig as any)._awsCredentials = expiredCredentials;

    // Mock fetch to return HTTP error
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: jest.fn().mockResolvedValue({ error: 'Invalid token' }),
    });

    setGlobalConfig(mockConfig);
    const logger = getLogger();

    // Logging operations should NOT throw errors
    await expect(logger.info('Test message with invalid credentials')).resolves.not.toThrow();

    // Verify that credential refresh was attempted
    expect(global.fetch).toHaveBeenCalled();

    // Verify that HTTP error was logged (not thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[TraceRoot] Failed to refresh AWS credentials:',
      'HTTP 401: Unauthorized'
    );
  });

  test('should NOT throw errors when CloudWatch transport encounters authentication errors', async () => {
    // Set up valid credentials initially
    const validCredentials = {
      aws_access_key_id: 'valid-access-key',
      aws_secret_access_key: 'valid-secret-key',
      aws_session_token: 'valid-session-token',
      region: 'us-east-1',
      hash: 'valid-hash',
      expiration_utc: new Date(Date.now() + 3600000), // 1 hour from now
      otlp_endpoint: 'http://localhost:4318',
    };

    (mockConfig as any)._awsCredentials = validCredentials;

    setGlobalConfig(mockConfig);
    const logger = getLogger();

    // Logging should NOT throw errors even when CloudWatch transport might fail
    // The main point is that authentication errors are handled gracefully
    await expect(
      logger.info('Test message that might cause CloudWatch auth error')
    ).resolves.not.toThrow();

    // This test verifies that the logger continues to work even if CloudWatch
    // encounters authentication issues. The actual CloudWatch error handling
    // is tested elsewhere - this test focuses on the logger not throwing errors.
  });

  test('should handle multiple consecutive credential failures gracefully', async () => {
    // Set up expired credentials
    const expiredCredentials = {
      aws_access_key_id: 'expired-access-key',
      aws_secret_access_key: 'expired-secret-key',
      aws_session_token: 'expired-session-token',
      region: 'us-east-1',
      hash: 'expired-hash',
      expiration_utc: new Date(Date.now() - 600000), // 10 minutes ago
      otlp_endpoint: 'http://localhost:4318',
    };

    (mockConfig as any)._awsCredentials = expiredCredentials;

    // Mock fetch to consistently fail
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network timeout'));

    setGlobalConfig(mockConfig);
    const logger = getLogger();

    // Multiple logging operations should all succeed without throwing
    const loggingPromises = [
      logger.debug('Debug message 1'),
      logger.info('Info message 1'),
      logger.warn('Warn message 1'),
      logger.error('Error message 1'),
      logger.critical('Critical message 1'),
      logger.debug('Debug message 2'),
      logger.info('Info message 2'),
      logger.warn('Warn message 2'),
      logger.error('Error message 2'),
      logger.critical('Critical message 2'),
    ];

    // All promises should resolve (not reject)
    await expect(Promise.all(loggingPromises)).resolves.toBeDefined();

    // Verify that credential refresh was attempted multiple times
    expect(global.fetch).toHaveBeenCalled();

    // Verify that network errors were logged (not thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[TraceRoot] Failed to refresh AWS credentials:',
      'Network timeout'
    );
  });

  test('should fail the test if TraceRoot throws any errors with invalid credentials', async () => {
    // This test demonstrates the expected behavior: TraceRoot should NOT throw errors
    // If TraceRoot were to throw errors with invalid credentials, this test would fail

    // Simulate the worst-case scenario: no token provided at all
    mockConfig.token = '';

    let threwError = false;
    try {
      setGlobalConfig(mockConfig);
      const logger = getLogger();
      await logger.info('This should not throw even with no credentials');
      await logger.error('This should not throw even with no credentials');
    } catch {
      threwError = true;
    }

    // The test expects NO errors to be thrown
    // If TraceRoot throws an error, threwError will be true and the test will fail
    expect(threwError).toBe(false);

    // Note: The console.log message about missing token would come from tracer initialization,
    // not logger initialization, so we don't test for it here as it's not directly related
    // to this test's scope (logger behavior with invalid credentials)
  });
});
