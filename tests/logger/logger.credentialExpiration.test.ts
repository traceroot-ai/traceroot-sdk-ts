import { TraceRootLogger } from '../../src/logger';
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
  };

  const formatMock: any = jest.fn((fn) => {
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

// Mock fetch for credential refresh
global.fetch = jest.fn();

describe('TraceRoot Logger Credential Expiration', () => {
  let logger: TraceRootLogger;
  let mockConfig: TraceRootConfigImpl;
  let mockWinstonLogger: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    mockConfig = {
      service_name: 'test-service',
      local_mode: false, // Not in local mode to test CloudWatch
      enable_log_console_export: true,
      enable_log_cloud_export: true,
      enable_span_console_export: true,
      github_commit_hash: 'abc123',
      github_owner: 'test-owner',
      github_repo_name: 'test-repo',
      environment: 'test',
      aws_region: 'us-east-1',
      otlp_endpoint: 'http://localhost:4318',
      _name: 'test-logger',
      _sub_name: 'test-sub-logger',
      token: 'test-token',
    };

    // Mock AWS credentials
    const mockCredentials = {
      aws_access_key_id: 'test-access-key',
      aws_secret_access_key: 'test-secret-key',
      aws_session_token: 'test-session-token',
      region: 'us-east-1',
      hash: 'test-hash',
      expiration_utc: new Date(Date.now() + 3600000), // 1 hour from now
      otlp_endpoint: 'http://localhost:4318',
    };

    (mockConfig as any)._awsCredentials = mockCredentials;

    logger = TraceRootLogger.create(mockConfig);

    // Get reference to the mocked winston logger
    const winston = require('winston');
    mockWinstonLogger = winston.createLogger();
  });

  describe('Credential expiration checking', () => {
    test('should not refresh credentials when they are not expired', async () => {
      // Mock fetch to not be called
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      await logger.info('Test message');

      // Fetch should not be called since credentials are not expired
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockWinstonLogger.info).toHaveBeenCalled();
    });

    test('should refresh credentials when they are expired', async () => {
      // Set credentials to be expired (10 minutes ago)
      const expiredCredentials = {
        aws_access_key_id: 'test-access-key',
        aws_secret_access_key: 'test-secret-key',
        aws_session_token: 'test-session-token',
        region: 'us-east-1',
        hash: 'test-hash',
        expiration_utc: new Date(Date.now() - 600000), // 10 minutes ago
        otlp_endpoint: 'http://localhost:4318',
      };

      (mockConfig as any)._awsCredentials = expiredCredentials;

      // Mock fetch to return new credentials
      const newCredentials = {
        aws_access_key_id: 'new-access-key',
        aws_secret_access_key: 'new-secret-key',
        aws_session_token: 'new-session-token',
        region: 'us-east-1',
        hash: 'new-hash',
        expiration_utc: new Date(Date.now() + 3600000), // 1 hour from now
        otlp_endpoint: 'http://localhost:4318',
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(newCredentials),
      });

      await logger.info('Test message');

      // Fetch should be called to refresh credentials
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.traceroot.ai/v1/verify/credentials?token=test-token',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      // Config should be updated with new credentials
      expect(mockConfig._name).toBe('new-hash');
      expect(mockConfig.otlp_endpoint).toBe('http://localhost:4318');
      expect((mockConfig as any)._awsCredentials).toEqual(newCredentials);

      expect(mockWinstonLogger.info).toHaveBeenCalled();
    });

    test('should refresh credentials when they are expiring soon (within 10 minutes)', async () => {
      // Set credentials to expire in 5 minutes (within the 10-minute buffer)
      const expiringCredentials = {
        aws_access_key_id: 'test-access-key',
        aws_secret_access_key: 'test-secret-key',
        aws_session_token: 'test-session-token',
        region: 'us-east-1',
        hash: 'test-hash',
        expiration_utc: new Date(Date.now() + 300000), // 5 minutes from now
        otlp_endpoint: 'http://localhost:4318',
      };

      (mockConfig as any)._awsCredentials = expiringCredentials;

      // Mock fetch to return new credentials
      const newCredentials = {
        aws_access_key_id: 'new-access-key',
        aws_secret_access_key: 'new-secret-key',
        aws_session_token: 'new-session-token',
        region: 'us-east-1',
        hash: 'new-hash',
        expiration_utc: new Date(Date.now() + 3600000), // 1 hour from now
        otlp_endpoint: 'http://localhost:4318',
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(newCredentials),
      });

      await logger.info('Test message');

      // Fetch should be called to refresh credentials
      expect(global.fetch).toHaveBeenCalled();
      expect(mockWinstonLogger.info).toHaveBeenCalled();
    });

    test('should handle credential refresh failure gracefully', async () => {
      // Set credentials to be expired
      const expiredCredentials = {
        aws_access_key_id: 'test-access-key',
        aws_secret_access_key: 'test-secret-key',
        aws_session_token: 'test-session-token',
        region: 'us-east-1',
        hash: 'test-hash',
        expiration_utc: new Date(Date.now() - 600000), // 10 minutes ago
        otlp_endpoint: 'http://localhost:4318',
      };

      (mockConfig as any)._awsCredentials = expiredCredentials;

      // Mock fetch to fail
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await logger.info('Test message');

      // Fetch should be called but fail
      expect(global.fetch).toHaveBeenCalled();

      // Logger should still work (fallback to console transport)
      expect(mockWinstonLogger.info).toHaveBeenCalled();
    });

    test('should handle concurrent credential refresh requests', async () => {
      // Set credentials to be expired
      const expiredCredentials = {
        aws_access_key_id: 'test-access-key',
        aws_secret_access_key: 'test-secret-key',
        aws_session_token: 'test-session-token',
        region: 'us-east-1',
        hash: 'test-hash',
        expiration_utc: new Date(Date.now() - 600000), // 10 minutes ago
        otlp_endpoint: 'http://localhost:4318',
      };

      (mockConfig as any)._awsCredentials = expiredCredentials;

      // Mock fetch to return new credentials
      const newCredentials = {
        aws_access_key_id: 'new-access-key',
        aws_secret_access_key: 'new-secret-key',
        aws_session_token: 'new-session-token',
        region: 'us-east-1',
        hash: 'new-hash',
        expiration_utc: new Date(Date.now() + 3600000), // 1 hour from now
        otlp_endpoint: 'http://localhost:4318',
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(newCredentials),
      });

      // Clear the mock to only count the concurrent calls
      (global.fetch as jest.Mock).mockClear();
      mockWinstonLogger.info.mockClear();

      // Make concurrent logging calls
      const promises = [
        logger.info('Test message 1'),
        logger.info('Test message 2'),
        logger.info('Test message 3'),
      ];

      await Promise.all(promises);

      // Fetch should only be called once due to the promise caching mechanism
      expect(global.fetch).toHaveBeenCalledTimes(1);
      // Each info() call results in 2 winston calls (console logger + main logger)
      expect(mockWinstonLogger.info).toHaveBeenCalledTimes(6);
    });

    test('should not refresh credentials in local mode', async () => {
      // Set to local mode
      mockConfig.local_mode = true;

      // Set credentials to be expired
      const expiredCredentials = {
        aws_access_key_id: 'test-access-key',
        aws_secret_access_key: 'test-secret-key',
        aws_session_token: 'test-session-token',
        region: 'us-east-1',
        hash: 'test-hash',
        expiration_utc: new Date(Date.now() - 600000), // 10 minutes ago
        otlp_endpoint: 'http://localhost:4318',
      };

      (mockConfig as any)._awsCredentials = expiredCredentials;

      logger = TraceRootLogger.create(mockConfig);

      await logger.info('Test message');

      // Fetch should not be called in local mode
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockWinstonLogger.info).toHaveBeenCalled();
    });
  });
});
