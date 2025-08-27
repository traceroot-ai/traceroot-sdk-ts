import { TraceRootLogger, initializeLogger } from '../../src/logger';
import { TraceRootConfigImpl } from '../../src/config';

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

// Mock winston-cloudwatch to simulate different error scenarios
const mockCloudWatchTransport = {
  on: jest.fn(),
  kthxbye: jest.fn((callback) => callback()), // Mock flush method with immediate callback
};

jest.mock('winston-cloudwatch', () => {
  return jest.fn().mockImplementation(() => mockCloudWatchTransport);
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

// Mock fetch for credential refresh testing
global.fetch = jest.fn();

describe('TraceRoot Logger with Runtime Expired Credentials', () => {
  let mockConfig: TraceRootConfigImpl;
  let logger: TraceRootLogger;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();

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
      _name: 'test-logger',
      _sub_name: 'test-sub-logger',
      token: 'valid-token',
    };
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('should handle CloudWatch transport errors when credentials expire during runtime', async () => {
    // Set up initially valid credentials that will "expire" during the test
    const initialCredentials = {
      aws_access_key_id: 'initially-valid-key',
      aws_secret_access_key: 'initially-valid-secret',
      aws_session_token: 'initially-valid-token',
      region: 'us-east-1',
      hash: 'initial-hash',
      expiration_utc: new Date(Date.now() + 3600000), // 1 hour from now
      otlp_endpoint: 'http://localhost:4318',
    };

    (mockConfig as any)._awsCredentials = initialCredentials;

    // Mock CloudWatch transport to simulate authentication error after credentials expire
    let errorCallback: ((error: any) => void) | null = null;
    mockCloudWatchTransport.on.mockImplementation(
      (event: string, callback: (error: any) => void) => {
        if (event === 'error') {
          errorCallback = callback;
        }
      }
    );

    logger = initializeLogger(mockConfig);

    // Simulate credentials expiring by updating the expiration time
    const expiredCredentials = {
      ...initialCredentials,
      expiration_utc: new Date(Date.now() - 600000), // 10 minutes ago (expired)
    };
    (mockConfig as any)._awsCredentials = expiredCredentials;

    // Mock credential refresh to fail
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Token has expired'));

    // This logging call should trigger credential check, find expired credentials,
    // attempt refresh (which fails), and then try to log with expired credentials
    const loggingPromise = logger.info('Test message with expired credentials');

    // Simulate CloudWatch transport emitting an authentication error
    // This could happen if the credentials expire between check and actual AWS call
    if (errorCallback) {
      setTimeout(() => {
        errorCallback!({
          message: 'The security token included in the request is expired',
          code: 'TokenRefreshRequired',
          statusCode: 403,
        });
      }, 50);
    }

    // The logging should NOT throw an error even when CloudWatch fails
    await expect(loggingPromise).resolves.not.toThrow();

    // Wait for error handler to potentially be called
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify that the system handled the error gracefully
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[TraceRoot] Failed to refresh AWS credentials:',
      'Token has expired'
    );
  });

  test('should handle winston-cloudwatch synchronous errors', async () => {
    // Set up expired credentials
    const expiredCredentials = {
      aws_access_key_id: 'expired-key',
      aws_secret_access_key: 'expired-secret',
      aws_session_token: 'expired-token',
      region: 'us-east-1',
      hash: 'expired-hash',
      expiration_utc: new Date(Date.now() - 600000), // 10 minutes ago
      otlp_endpoint: 'http://localhost:4318',
    };

    (mockConfig as any)._awsCredentials = expiredCredentials;

    // Mock winston logger to throw an error (simulating winston-cloudwatch throwing)
    const winston = require('winston');
    const mockWinstonLogger = winston.createLogger();
    mockWinstonLogger.info.mockImplementation(() => {
      throw new Error('AWS authentication failed - expired token');
    });

    // Mock credential refresh to also fail
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Unable to refresh token'));

    logger = initializeLogger(mockConfig);

    // This test verifies what happens if winston itself throws errors
    // The question is: does TraceRoot catch these synchronous errors?
    let threwError = false;
    try {
      await logger.info('Test message that might cause winston to throw');
    } catch (error) {
      threwError = true;
      console.log('Caught error from logger:', error);
    }

    // Currently, this might fail if winston throws synchronous errors
    // This test will reveal if there are unhandled synchronous errors
    expect(threwError).toBe(false); // We hope this passes, but it might fail!
  });

  test('should demonstrate race condition between credential check and CloudWatch call', async () => {
    // This test demonstrates the race condition scenario

    // Set up credentials that are valid but will expire very soon
    const soonToExpireCredentials = {
      aws_access_key_id: 'soon-to-expire-key',
      aws_secret_access_key: 'soon-to-expire-secret',
      aws_session_token: 'soon-to-expire-token',
      region: 'us-east-1',
      hash: 'soon-to-expire-hash',
      expiration_utc: new Date(Date.now() + 5000), // 5 seconds from now
      otlp_endpoint: 'http://localhost:4318',
    };

    (mockConfig as any)._awsCredentials = soonToExpireCredentials;

    logger = initializeLogger(mockConfig);

    // Mock a successful credential refresh
    const newCredentials = {
      ...soonToExpireCredentials,
      aws_access_key_id: 'new-key',
      expiration_utc: new Date(Date.now() + 3600000), // 1 hour from now
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(newCredentials),
    });

    // Make multiple rapid logging calls
    // Some might be processed with old credentials, some with new
    const rapidLoggingPromises = Array.from({ length: 10 }, (_, i) =>
      logger.info(`Rapid message ${i}`)
    );

    // All logging calls should complete without throwing
    await expect(Promise.all(rapidLoggingPromises)).resolves.toBeDefined();

    // The key point: even with race conditions, no errors should be thrown
    // Errors should be logged to console but not propagated
  });
});
