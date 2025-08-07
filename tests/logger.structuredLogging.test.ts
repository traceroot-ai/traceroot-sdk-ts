import { TraceRootLogger } from '../src/logger';
import { TraceRootConfigImpl } from '../src/config';

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

describe('TraceRoot Logger Structured Logging', () => {
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
      enable_span_console_export: true,
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

  describe('Simple string messages', () => {
    test('should handle simple string message', () => {
      logger.info('Simple message');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Simple message',
        expect.objectContaining({
          stack_trace: expect.any(String),
        })
      );
    });

    test('should work for all log levels', () => {
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');
      logger.critical('Critical message');

      expect(mockWinstonLogger.debug).toHaveBeenCalledWith(
        'Debug message',
        expect.objectContaining({ stack_trace: expect.any(String) })
      );
      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Info message',
        expect.objectContaining({ stack_trace: expect.any(String) })
      );
      expect(mockWinstonLogger.warn).toHaveBeenCalledWith(
        'Warn message',
        expect.objectContaining({ stack_trace: expect.any(String) })
      );
      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        'Error message',
        expect.objectContaining({ stack_trace: expect.any(String) })
      );
      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        'Critical message',
        expect.objectContaining({
          level: 'critical',
          stack_trace: expect.any(String)
        })
      );
    });
  });

  describe('Structured logging with objects', () => {
    test('should handle object as first argument with string message', () => {
      const metadata = { requestId: '123', userId: 'user456' };
      logger.info(metadata, 'Handling request');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Handling request',
        expect.objectContaining({
          requestId: '123',
          userId: 'user456',
          stack_trace: expect.any(String),
        })
      );
    });

    test('should handle object without message', () => {
      const metadata = { requestId: '123', userId: 'user456' };
      logger.info(metadata);

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Log entry',
        expect.objectContaining({
          requestId: '123',
          userId: 'user456',
          stack_trace: expect.any(String),
        })
      );
    });
  });

  describe('Simplified pino-style API', () => {
    test('should handle only the clean pino patterns', () => {
      // Test 1: Object + message (the main pino pattern)
      const metadata = { requestId: '123', userId: 'user456' };
      logger.info(metadata, 'Processing request');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Processing request',
        expect.objectContaining({
          requestId: '123',
          userId: 'user456',
          stack_trace: expect.any(String),
        })
      );
    });

    test('should not support complex multi-argument patterns', () => {
      // These patterns are no longer supported - they fall back to string conversion
      logger.info('Message', { shouldNotBeMerged: true });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Message',
        expect.objectContaining({
          stack_trace: expect.any(String),
        })
      );

      // The object should NOT be merged since string comes first
      expect(mockWinstonLogger.info).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          shouldNotBeMerged: true,
        })
      );
    });
  });

  describe('Edge cases', () => {
    test('should handle null and undefined values in metadata', () => {
      logger.info({ requestId: '123', nullValue: null, undefinedValue: undefined }, 'Test message');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Test message',
        expect.objectContaining({
          requestId: '123',
          nullValue: null,
          undefinedValue: undefined,
          stack_trace: expect.any(String),
        })
      );
    });

    test('should handle non-object first argument as string conversion', () => {
      logger.info(123);

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        '123',
        expect.objectContaining({
          stack_trace: expect.any(String),
        })
      );
    });

    test('should handle array as first argument as string conversion', () => {
      logger.info([1, 2, 3]);

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        '1,2,3',
        expect.objectContaining({
          stack_trace: expect.any(String),
        })
      );
    });

    test('should handle empty object', () => {
      logger.info({}, 'Empty object');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Empty object',
        expect.objectContaining({
          stack_trace: expect.any(String),
        })
      );
    });
  });

  describe('Clean API behavior', () => {
    test('should not merge metadata when string comes first', () => {
      // This pattern is no longer supported - additional args are ignored
      logger.info('Message first', { shouldBeIgnored: 'value' });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Message first',
        expect.objectContaining({
          stack_trace: expect.any(String),
        })
      );

      // Should NOT contain the metadata
      expect(mockWinstonLogger.info).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          shouldBeIgnored: 'value',
        })
      );
    });

    test('should handle single argument patterns correctly', () => {
      logger.info('Just a message');
      logger.info({ justData: 'value' });

      expect(mockWinstonLogger.info).toHaveBeenNthCalledWith(1,
        'Just a message',
        expect.objectContaining({
          stack_trace: expect.any(String),
        })
      );

      expect(mockWinstonLogger.info).toHaveBeenNthCalledWith(2,
        'Log entry',
        expect.objectContaining({
          justData: 'value',
          stack_trace: expect.any(String),
        })
      );
    });
  });
});
