import { setGlobalConfig, getLogger } from '../../src/logger';
import { TraceRootConfigImpl } from '../../src/config';

// Mock winston and related dependencies
jest.mock('winston', () => {
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    on: jest.fn(),
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
  PutLogEventsCommand: jest.fn(),
}));

jest.mock('../../src/api/credential', () => ({
  fetchAwsCredentialsSync: jest.fn(),
}));

// Mock fetch for credential refresh
global.fetch = jest.fn();

describe('TraceRoot Logger Credential Refresh with Time Control', () => {
  let mockWinstonLogger: any;
  let mockConfig: TraceRootConfigImpl;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Use jest's useFakeTimers for better time control
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-08-22T10:00:00.000Z'));

    // Mock winston logger
    const winston = require('winston');
    mockWinstonLogger = winston.createLogger();

    // Mock configuration
    mockConfig = {
      service_name: 'test-service',
      local_mode: false, // Not in local mode to test CloudWatch
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
      token: 'test-token',
      _awsCredentials: null,
    } as any;

    // Set up console spies
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Reset fetch mock
    (global.fetch as jest.Mock).mockClear();
  });

  afterEach(() => {
    // Restore real timers
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.clearAllMocks();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });


  const createCredentials = (expirationOffset: number) => ({
    aws_access_key_id: 'test-access-key-id',
    aws_secret_access_key: 'test-secret-access-key',
    aws_session_token: 'test-session-token',
    region: 'us-east-1',
    hash: 'test-hash',
    expiration_utc: new Date(Date.now() + expirationOffset), // Already a Date object as expected by the logger
    otlp_endpoint: 'http://localhost:4318',
  });

  describe('Credential refresh with time manipulation', () => {
    test('should NOT refresh credentials when they are valid (outside 30-minute buffer)', async () => {
      // Set credentials to expire in 45 minutes (outside the 30-minute buffer)
      const validCredentials = createCredentials(45 * 60 * 1000); // 45 minutes from now
      (mockConfig as any)._awsCredentials = validCredentials;

      setGlobalConfig(mockConfig);
      const logger = getLogger();

      // Mock fetch to detect if it's called
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          aws_access_key_id: 'new-access-key',
          aws_secret_access_key: 'new-secret-key',
          aws_session_token: 'new-session-token',
          region: 'us-east-1',
          hash: 'new-hash',
          expiration_utc: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
          otlp_endpoint: 'http://localhost:4318',
        }),
      });

      await logger.info('Test message with valid credentials');

      // Fetch should NOT be called since credentials are still valid
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockWinstonLogger.info).toHaveBeenCalled();
    });

    test('should refresh credentials when they expire within the 30-minute buffer', async () => {
      // Set credentials to expire in 20 minutes (within the 30-minute buffer)
      const expiringSoonCredentials = createCredentials(20 * 60 * 1000); // 20 minutes from now
      (mockConfig as any)._awsCredentials = expiringSoonCredentials;

      setGlobalConfig(mockConfig);
      const logger = getLogger();

      // Mock successful credential refresh
      const newCredentials = {
        aws_access_key_id: 'refreshed-access-key',
        aws_secret_access_key: 'refreshed-secret-key',
        aws_session_token: 'refreshed-session-token',
        region: 'us-west-2',
        hash: 'refreshed-hash',
        expiration_utc: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
        otlp_endpoint: 'http://localhost:4318',
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(newCredentials),
      });

      await logger.info('Test message triggering credential refresh');

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

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TraceRoot] AWS credentials expired or expiring soon, refreshing...'
      );

      expect(mockWinstonLogger.info).toHaveBeenCalled();
    });

    test('should refresh credentials when time advances to make them expire', async () => {
      // Initially set credentials to expire in 45 minutes (valid)
      const initialCredentials = createCredentials(45 * 60 * 1000); // 45 minutes from now
      (mockConfig as any)._awsCredentials = initialCredentials;

      setGlobalConfig(mockConfig);
      const logger = getLogger();

      // First call should not trigger refresh
      await logger.info('First message with valid credentials');
      expect(global.fetch).not.toHaveBeenCalled();

      // Advance time by 20 minutes - now credentials expire in 25 minutes (within 30-minute buffer)
      jest.advanceTimersByTime(20 * 60 * 1000); // Advance by 20 minutes

      // Mock successful credential refresh for the second call
      const refreshedCredentials = {
        aws_access_key_id: 'time-advanced-access-key',
        aws_secret_access_key: 'time-advanced-secret-key',
        aws_session_token: 'time-advanced-session-token',
        region: 'us-west-2',
        hash: 'time-advanced-hash',
        expiration_utc: new Date(Date.now() + 90 * 60 * 1000).toISOString(), // 90 minutes from new current time
        otlp_endpoint: 'http://localhost:4318',
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(refreshedCredentials),
      });

      // Second call should now trigger refresh due to time advancement
      await logger.info('Second message after time advancement');

      // Fetch should now be called
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.traceroot.ai/v1/verify/credentials?token=test-token',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TraceRoot] AWS credentials expired or expiring soon, refreshing...'
      );

      // Both logging calls should succeed (may be more due to credential refresh process)
      expect(mockWinstonLogger.info).toHaveBeenCalled();
    });

    test('should handle credential refresh and continue logging after successful refresh', async () => {
      // Set credentials to be already expired
      const expiredCredentials = createCredentials(-10 * 60 * 1000); // 10 minutes ago
      (mockConfig as any)._awsCredentials = expiredCredentials;

      setGlobalConfig(mockConfig);
      const logger = getLogger();

      // Mock successful credential refresh
      const freshCredentials = {
        aws_access_key_id: 'fresh-access-key',
        aws_secret_access_key: 'fresh-secret-key',
        aws_session_token: 'fresh-session-token',
        region: 'eu-west-1',
        hash: 'fresh-hash',
        expiration_utc: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
        otlp_endpoint: 'http://localhost:4318',
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(freshCredentials),
      });

      // Multiple logging operations should all work
      await logger.debug('Debug message after refresh');
      await logger.info('Info message after refresh');
      await logger.warn('Warn message after refresh');
      await logger.error('Error message after refresh');

      // Verify credential refresh was called
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.traceroot.ai/v1/verify/credentials?token=test-token',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TraceRoot] AWS credentials expired or expiring soon, refreshing...'
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TraceRoot] Successfully recreated CloudWatch transport with new credentials'
      );

      // All logging operations should succeed
      expect(mockWinstonLogger.debug).toHaveBeenCalledWith(
        'Debug message after refresh',
        expect.any(Object)
      );
      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Info message after refresh',
        expect.any(Object)
      );
      expect(mockWinstonLogger.warn).toHaveBeenCalledWith(
        'Warn message after refresh',
        expect.any(Object)
      );
      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        'Error message after refresh',
        expect.any(Object)
      );
    });

    test('should handle credential refresh failure gracefully and continue logging', async () => {
      // Set credentials to be expired
      const expiredCredentials = createCredentials(-5 * 60 * 1000); // 5 minutes ago
      (mockConfig as any)._awsCredentials = expiredCredentials;

      setGlobalConfig(mockConfig);
      const logger = getLogger();

      // Mock credential refresh failure
      (global.fetch as jest.Mock).mockRejectedValue(new Error('API temporarily unavailable'));

      // Logging should still work even when refresh fails
      await expect(logger.info('Message with failed credential refresh')).resolves.not.toThrow();

      // Verify that refresh was attempted
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.traceroot.ai/v1/verify/credentials?token=test-token',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TraceRoot] AWS credentials expired or expiring soon, refreshing...'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[TraceRoot] Failed to refresh AWS credentials:',
        'API temporarily unavailable'
      );

      // Logging should still proceed despite refresh failure
      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Message with failed credential refresh',
        expect.any(Object)
      );
    });

    test('should test exact 30-minute buffer boundary', async () => {
      // Set credentials to expire in exactly 30 minutes (at the buffer boundary)
      const boundaryCredentials = createCredentials(30 * 60 * 1000); // exactly 30 minutes from now
      (mockConfig as any)._awsCredentials = boundaryCredentials;

      setGlobalConfig(mockConfig);
      const logger = getLogger();

      const refreshedCredentials = {
        aws_access_key_id: 'boundary-access-key',
        aws_secret_access_key: 'boundary-secret-key',
        aws_session_token: 'boundary-session-token',
        region: 'ap-southeast-1',
        hash: 'boundary-hash',
        expiration_utc: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), // 3 hours from now
        otlp_endpoint: 'http://localhost:4318',
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(refreshedCredentials),
      });

      await logger.info('Message at 30-minute boundary');

      // Should trigger refresh at exactly the 30-minute mark
      expect(global.fetch).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TraceRoot] AWS credentials expired or expiring soon, refreshing...'
      );

      expect(mockWinstonLogger.info).toHaveBeenCalled();
    });
  });
});
