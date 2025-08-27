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
    kthxbye: jest.fn((callback) => callback()), // Mock flush method with immediate callback
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

describe('TraceRoot Logger Multiple Object Merging', () => {
  let logger: TraceRootLogger;
  let mockConfig: TraceRootConfigImpl;
  let mockWinstonLogger: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    mockConfig = {
      service_name: 'test-service',
      local_mode: true,
      enable_log_console_export: true,
      enable_log_cloud_export: false,
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
    };

    logger = TraceRootLogger.create(mockConfig);

    // Get reference to the mocked winston logger
    const winston = require('winston');
    mockWinstonLogger = winston.createLogger();
  });

  describe('Multiple object merging', () => {
    test('should merge object + message + object', () => {
      logger.info({ user: 'bob' }, 'User action', { action: 'logout', success: true });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'User action',
        expect.objectContaining({
          user: 'bob',
          action: 'logout',
          success: true,
          stack_trace: expect.any(String),
        })
      );
    });

    test('should merge object + object + message', () => {
      logger.info({ user: 'charlie' }, { action: 'purchase', amount: 100 }, 'Purchase completed');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Purchase completed',
        expect.objectContaining({
          user: 'charlie',
          action: 'purchase',
          amount: 100,
          stack_trace: expect.any(String),
        })
      );
    });

    test('should merge multiple objects without message and use default', () => {
      logger.info({ user: 'dave' }, { action: 'view', page: 'dashboard' });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Log entry',
        expect.objectContaining({
          user: 'dave',
          action: 'view',
          page: 'dashboard',
          stack_trace: expect.any(String),
        })
      );
    });

    test('should handle overlapping keys - preserve both values with indexed keys', () => {
      logger.info({ user: 'alice', status: 'pending' }, { status: 'completed' }, 'Task updated');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Task updated',
        expect.objectContaining({
          user: 'alice',
          status_0: 'pending', // First occurrence gets _0 suffix
          status_1: 'completed', // Second occurrence gets _1 suffix
          stack_trace: expect.any(String),
        })
      );
    });

    test('should handle three or more objects', () => {
      logger.info(
        { user: 'eve' },
        { action: 'create' },
        { resource: 'document', id: 123 },
        'Resource created'
      );

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Resource created',
        expect.objectContaining({
          user: 'eve',
          action: 'create',
          resource: 'document',
          id: 123,
          stack_trace: expect.any(String),
        })
      );
    });

    test('should still work with existing single object + message pattern', () => {
      logger.info({ user: 'alice', action: 'login' }, 'User logged in');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'User logged in',
        expect.objectContaining({
          user: 'alice',
          action: 'login',
          stack_trace: expect.any(String),
        })
      );
    });

    test('should still work with string-only messages', () => {
      logger.info('Simple message');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Simple message',
        expect.objectContaining({
          stack_trace: expect.any(String),
        })
      );
    });
  });
});
