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

describe('TraceRoot Logger Duplicate Property Preservation', () => {
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

  describe('Simple duplicate property cases', () => {
    test('should preserve both values when same property appears in two objects', () => {
      logger.info({ a: 'property' }, { a: 'prop' });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Log entry',
        expect.objectContaining({
          a_0: 'property',
          a_1: 'prop',
          stack_trace: expect.any(String),
        })
      );
    });

    test('should preserve values with string message', () => {
      logger.info({ status: 'pending' }, 'Processing', { status: 'completed' });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Processing',
        expect.objectContaining({
          status_0: 'pending',
          status_1: 'completed',
          stack_trace: expect.any(String),
        })
      );
    });

    test('should handle mixed unique and duplicate properties', () => {
      logger.info({ user: 'alice', status: 'pending' }, { action: 'login', status: 'success' });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Log entry',
        expect.objectContaining({
          user: 'alice',
          action: 'login',
          status_0: 'pending',
          status_1: 'success',
          stack_trace: expect.any(String),
        })
      );
    });
  });

  describe('Multiple duplicates', () => {
    test('should handle three objects with same property', () => {
      logger.info({ level: 'info' }, { level: 'warn' }, { level: 'error' }, 'Multiple levels');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Multiple levels',
        expect.objectContaining({
          level_0: 'info',
          level_1: 'warn',
          level_2: 'error',
          stack_trace: expect.any(String),
        })
      );
    });

    test('should handle multiple properties with duplicates', () => {
      logger.info(
        { user: 'alice', action: 'read' },
        { user: 'bob', resource: 'file' },
        { action: 'write', timestamp: '2023-01-01' }
      );

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Log entry',
        expect.objectContaining({
          user_0: 'alice',
          user_1: 'bob',
          action_0: 'read',
          action_1: 'write',
          resource: 'file',
          timestamp: '2023-01-01',
          stack_trace: expect.any(String),
        })
      );
    });
  });

  describe('Edge cases', () => {
    test('should handle objects with null and undefined duplicate values', () => {
      logger.info({ value: null }, { value: undefined }, { value: 'actual' });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Log entry',
        expect.objectContaining({
          value_0: null,
          value_1: undefined,
          value_2: 'actual',
          stack_trace: expect.any(String),
        })
      );
    });

    test('should handle nested object duplicates', () => {
      const obj1 = { config: { enabled: true } };
      const obj2 = { config: { timeout: 1000 } };

      logger.info(obj1, obj2, 'Nested configs');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Nested configs',
        expect.objectContaining({
          config_0: { enabled: true },
          config_1: { timeout: 1000 },
          stack_trace: expect.any(String),
        })
      );
    });

    test('should handle array value duplicates', () => {
      logger.info({ tags: ['api', 'auth'] }, { tags: ['user', 'login'] });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Log entry',
        expect.objectContaining({
          tags_0: ['api', 'auth'],
          tags_1: ['user', 'login'],
          stack_trace: expect.any(String),
        })
      );
    });

    test('should preserve property order within each object', () => {
      logger.info({ first: 1, second: 2, third: 3 }, { second: 'two', fourth: 4, first: 'one' });

      const expectedCall = mockWinstonLogger.info.mock.calls.find(
        (call: any[]) => call[1] && call[1].stack_trace
      );

      expect(expectedCall).toBeDefined();
      expect(expectedCall[1]).toEqual(
        expect.objectContaining({
          first_0: 1,
          second_0: 2,
          third: 3,
          second_1: 'two',
          fourth: 4,
          first_1: 'one',
          stack_trace: expect.any(String),
        })
      );
    });
  });

  describe('All log levels', () => {
    test('should preserve duplicates in debug logs', () => {
      logger.debug({ type: 'request' }, { type: 'response' });

      expect(mockWinstonLogger.debug).toHaveBeenCalledWith(
        'Log entry',
        expect.objectContaining({
          type_0: 'request',
          type_1: 'response',
          stack_trace: expect.any(String),
        })
      );
    });

    test('should preserve duplicates in warn logs', () => {
      logger.warn({ severity: 'low' }, { severity: 'high' }, 'Warning');

      expect(mockWinstonLogger.warn).toHaveBeenCalledWith(
        'Warning',
        expect.objectContaining({
          severity_0: 'low',
          severity_1: 'high',
          stack_trace: expect.any(String),
        })
      );
    });

    test('should preserve duplicates in error logs', () => {
      logger.error({ code: 400 }, { code: 500 }, 'Multiple errors');

      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        'Multiple errors',
        expect.objectContaining({
          code_0: 400,
          code_1: 500,
          stack_trace: expect.any(String),
        })
      );
    });

    test('should preserve duplicates in critical logs', () => {
      logger.critical({ alert: 'system' }, { alert: 'security' });

      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        'Log entry',
        expect.objectContaining({
          alert_0: 'system',
          alert_1: 'security',
          level: 'critical',
          stack_trace: expect.any(String),
        })
      );
    });
  });
});
