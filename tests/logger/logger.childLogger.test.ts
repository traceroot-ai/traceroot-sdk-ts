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

describe('TraceRoot Logger Child Logger Functionality', () => {
  let parentLogger: TraceRootLogger;
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

    parentLogger = TraceRootLogger.create(mockConfig);

    // Get reference to the mocked winston logger
    const winston = require('winston');
    mockWinstonLogger = winston.createLogger();
  });

  describe('Basic child logger creation', () => {
    test('should create child logger with context', () => {
      const childLogger = parentLogger.child({ module: 'auth' });

      expect(childLogger).toBeDefined();
      expect(childLogger).toBeInstanceOf(TraceRootLogger);
    });

    test('child logger should have context merged in logs', () => {
      const childLogger = parentLogger.child({ module: 'auth' });
      childLogger.info('User login attempt');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'User login attempt',
        expect.objectContaining({
          module: 'auth',
          stack_trace: expect.any(String),
        })
      );
    });

    test('child context should be merged with runtime metadata', () => {
      const childLogger = parentLogger.child({ module: 'auth' });
      childLogger.info({ userId: '123' }, 'User login attempt');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'User login attempt',
        expect.objectContaining({
          module: 'auth', // From child context
          userId: '123', // From runtime metadata
          stack_trace: expect.any(String),
        })
      );
    });

    test('child context should not be overridable by runtime metadata (pino behavior)', () => {
      const childLogger = parentLogger.child({ status: 'pending' });
      childLogger.info({ status: 'completed' }, 'Task finished');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Task finished',
        expect.objectContaining({
          status: 'pending', // Child context takes precedence (pino behavior)
          stack_trace: expect.any(String),
        })
      );
    });
  });

  describe('Nested child loggers', () => {
    test('should support nested child loggers', () => {
      const serviceChild = parentLogger.child({ service: 'auth' });
      const operationChild = serviceChild.child({ operation: 'login' });

      operationChild.info('Processing login');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Processing login',
        expect.objectContaining({
          service: 'auth', // From first level
          operation: 'login', // From second level
          stack_trace: expect.any(String),
        })
      );
    });

    test('nested child context should merge correctly', () => {
      const l1Child = parentLogger.child({ level1: 'value1', shared: 'parent' });
      const l2Child = l1Child.child({ level2: 'value2', shared: 'child' });

      l2Child.info('Nested message');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Nested message',
        expect.objectContaining({
          level1: 'value1',
          level2: 'value2',
          shared: 'child', // More specific child overrides parent in hierarchy
          stack_trace: expect.any(String),
        })
      );
    });

    test('deeply nested child loggers should work', () => {
      const child1 = parentLogger.child({ l1: 'value1' });
      const child2 = child1.child({ l2: 'value2' });
      const child3 = child2.child({ l3: 'value3' });

      child3.info('Deep nesting test');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Deep nesting test',
        expect.objectContaining({
          l1: 'value1',
          l2: 'value2',
          l3: 'value3',
          stack_trace: expect.any(String),
        })
      );
    });
  });

  describe('Child logger methods', () => {
    let childLogger: TraceRootLogger;

    beforeEach(() => {
      childLogger = parentLogger.child({ module: 'test' });
    });

    test('debug method should include child context', () => {
      childLogger.debug('Debug message');

      expect(mockWinstonLogger.debug).toHaveBeenCalledWith(
        'Debug message',
        expect.objectContaining({
          module: 'test',
          stack_trace: expect.any(String),
        })
      );
    });

    test('info method should include child context', () => {
      childLogger.info('Info message');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Info message',
        expect.objectContaining({
          module: 'test',
          stack_trace: expect.any(String),
        })
      );
    });

    test('warn method should include child context', () => {
      childLogger.warn('Warn message');

      expect(mockWinstonLogger.warn).toHaveBeenCalledWith(
        'Warn message',
        expect.objectContaining({
          module: 'test',
          stack_trace: expect.any(String),
        })
      );
    });

    test('error method should include child context', () => {
      childLogger.error('Error message');

      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        'Error message',
        expect.objectContaining({
          module: 'test',
          stack_trace: expect.any(String),
        })
      );
    });

    test('critical method should include child context', () => {
      childLogger.critical('Critical message');

      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        'Critical message',
        expect.objectContaining({
          module: 'test',
          level: 'critical',
          stack_trace: expect.any(String),
        })
      );
    });
  });

  describe('Complex context merging scenarios', () => {
    test('should handle multiple objects in child context and runtime', () => {
      const childLogger = parentLogger.child({
        service: 'auth',
        version: '1.0',
      });

      childLogger.info(
        { userId: '123', action: 'login' },
        { sessionId: 'abc', timestamp: Date.now() },
        'Complex merge test'
      );

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Complex merge test',
        expect.objectContaining({
          service: 'auth', // From child context
          version: '1.0', // From child context
          userId: '123', // From runtime
          action: 'login', // From runtime
          sessionId: 'abc', // From runtime
          timestamp: expect.any(Number), // From runtime
          stack_trace: expect.any(String),
        })
      );
    });

    test('should handle empty child context', () => {
      const childLogger = parentLogger.child({});
      childLogger.info({ data: 'test' }, 'Empty context test');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Empty context test',
        expect.objectContaining({
          data: 'test',
          stack_trace: expect.any(String),
        })
      );
    });

    test('should handle complex nested objects', () => {
      const childLogger = parentLogger.child({
        config: { env: 'test', debug: true },
      });

      childLogger.info(
        {
          request: { method: 'POST', path: '/login' },
        },
        'Complex objects'
      );

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Complex objects',
        expect.objectContaining({
          config: { env: 'test', debug: true },
          request: { method: 'POST', path: '/login' },
          stack_trace: expect.any(String),
        })
      );
    });
  });

  describe('Child logger from child logger', () => {
    test('child of child should work correctly', () => {
      const serviceChild = parentLogger.child({ service: 'auth' });
      const moduleChild = serviceChild.child({ module: 'login' });
      const operationChild = moduleChild.child({ operation: 'validate' });

      operationChild.info('Deeply nested child logger');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Deeply nested child logger',
        expect.objectContaining({
          service: 'auth',
          module: 'login',
          operation: 'validate',
          stack_trace: expect.any(String),
        })
      );
    });
  });

  describe('Flush delegation', () => {
    test('child logger flush should work without errors', async () => {
      const childLogger = parentLogger.child({ module: 'test' });

      // Should not throw and should complete
      await expect(childLogger.flush()).resolves.toBeUndefined();
    });
  });
});
