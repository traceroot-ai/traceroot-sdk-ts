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
    transports: [],
    level: 'debug',
  };

  const mockConsoleLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    add: jest.fn(),
    on: jest.fn(),
    remove: jest.fn(),
    transports: [],
    level: 'debug',
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

  let loggerCallCount = 0;
  const winston = {
    createLogger: jest.fn(() => {
      loggerCallCount++;
      // First call returns main logger, second call returns console logger
      return loggerCallCount === 1 ? mockLogger : mockConsoleLogger;
    }),
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
    kthxbye: jest.fn(callback => callback()),
  }));
});

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: jest.fn(() => null),
  },
}));

describe('TraceRoot Child Logger Level Behavior', () => {
  let mockConfig: TraceRootConfigImpl;
  let mockWinstonLogger: any;

  beforeEach(() => {
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
      log_level: 'debug' as const,
      tracer_verbose: false,
      _name: 'test-logger',
      _sub_name: 'test-sub-logger',
    };

    // Get references to the mocked loggers
    const winston = require('winston');
    // Reset call count for fresh loggers
    (winston.createLogger as jest.Mock).mockClear();

    mockWinstonLogger = winston.createLogger();
  });

  describe('Child logger level inheritance', () => {
    test('child logger should use same winston logger instance as parent', () => {
      const parentLogger = TraceRootLogger.create(mockConfig);
      const childLogger = parentLogger.child({ module: 'test' });

      // Child should reference the same logger instances as parent
      expect((childLogger as any).logger).toBe((parentLogger as any).logger);
      expect((childLogger as any).consoleLogger).toBe((parentLogger as any).consoleLogger);
    });

    test('child logger should inherit all log level behavior from parent', async () => {
      const parentLogger = TraceRootLogger.create(mockConfig);
      const childLogger = parentLogger.child({ service: 'auth' });

      // Test all log levels work at child level
      await childLogger.debug('Child debug message');
      await childLogger.info('Child info message');
      await childLogger.warn('Child warn message');
      await childLogger.error('Child error message');
      await childLogger.critical('Child critical message');

      // Since they share the same winston logger, calls should go to the same mock
      expect(mockWinstonLogger.debug).toHaveBeenCalledWith(
        'Child debug message',
        expect.objectContaining({
          service: 'auth',
          stack_trace: expect.any(String),
        })
      );

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Child info message',
        expect.objectContaining({
          service: 'auth',
          stack_trace: expect.any(String),
        })
      );

      expect(mockWinstonLogger.warn).toHaveBeenCalledWith(
        'Child warn message',
        expect.objectContaining({
          service: 'auth',
          stack_trace: expect.any(String),
        })
      );

      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        'Child error message',
        expect.objectContaining({
          service: 'auth',
          stack_trace: expect.any(String),
        })
      );

      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        'Child critical message',
        expect.objectContaining({
          service: 'auth',
          level: 'critical',
          stack_trace: expect.any(String),
        })
      );
    });

    test('nested child logger should inherit log level from root logger', async () => {
      const rootLogger = TraceRootLogger.create(mockConfig);
      const childLogger = rootLogger.child({ service: 'auth' });
      const grandchildLogger = childLogger.child({ module: 'login' });
      const greatGrandchildLogger = grandchildLogger.child({ operation: 'validate' });

      // All should share the same logger instances
      expect((greatGrandchildLogger as any).logger).toBe((rootLogger as any).logger);
      expect((greatGrandchildLogger as any).consoleLogger).toBe((rootLogger as any).consoleLogger);

      await greatGrandchildLogger.info('Deep nested message');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Deep nested message',
        expect.objectContaining({
          service: 'auth',
          module: 'login',
          operation: 'validate',
          stack_trace: expect.any(String),
        })
      );
    });

    test('child logger should not create its own winston logger instance', () => {
      const winston = require('winston');
      const createLoggerSpy = winston.createLogger as jest.Mock;

      createLoggerSpy.mockClear();

      const parentLogger = TraceRootLogger.create(mockConfig);

      // Parent creates main logger + console logger = 2 calls
      expect(createLoggerSpy).toHaveBeenCalledTimes(2);

      // Creating child should not create additional loggers
      const childLogger = parentLogger.child({ module: 'test' });
      expect(createLoggerSpy).toHaveBeenCalledTimes(2); // Still 2, no additional calls

      // Creating nested child should not create additional loggers
      childLogger.child({ operation: 'login' });
      expect(createLoggerSpy).toHaveBeenCalledTimes(2); // Still 2, no additional calls
    });
  });

  describe('Child logger console export level inheritance', () => {
    test('child logger should inherit console export settings from parent', () => {
      mockConfig.enable_log_console_export = true;

      const parentLogger = TraceRootLogger.create(mockConfig);
      const childLogger = parentLogger.child({ module: 'test' });

      // Both should have the same console logger reference
      const parentConsoleLogger = (parentLogger as any).consoleLogger;
      const childConsoleLogger = (childLogger as any).consoleLogger;

      expect(parentConsoleLogger).toBeDefined();
      expect(parentConsoleLogger).not.toBeNull();
      expect(childConsoleLogger).toBe(parentConsoleLogger);
    });

    test('child logger should respect parent console export disabled setting', () => {
      mockConfig.enable_log_console_export = false;

      const parentLogger = TraceRootLogger.create(mockConfig);
      const childLogger = parentLogger.child({ module: 'test' });

      // Both should have null console logger
      expect((parentLogger as any).consoleLogger).toBeNull();
      expect((childLogger as any).consoleLogger).toBeNull();
    });
  });

  describe('Child logger CloudWatch transport level inheritance', () => {
    test('child logger should not manage CloudWatch transport directly', () => {
      mockConfig.local_mode = false;
      mockConfig.enable_log_cloud_export = true;

      // Mock AWS credentials
      (mockConfig as any)._awsCredentials = {
        aws_access_key_id: 'test-key',
        aws_secret_access_key: 'test-secret',
        aws_session_token: 'test-token',
        region: 'us-east-1',
      };

      const parentLogger = TraceRootLogger.create(mockConfig);
      const childLogger = parentLogger.child({ module: 'test' });

      // Parent should have CloudWatch transport, child should not manage it
      expect((parentLogger as any).cloudWatchTransport).toBeDefined();
      expect((childLogger as any).cloudWatchTransport).toBeNull(); // Child doesn't manage transports
    });

    test('child logger should delegate credential management to root logger', async () => {
      mockConfig.local_mode = false;
      mockConfig.enable_log_cloud_export = true;

      // Mock AWS credentials
      (mockConfig as any)._awsCredentials = {
        aws_access_key_id: 'test-key',
        aws_secret_access_key: 'test-secret',
        aws_session_token: 'test-token',
        region: 'us-east-1',
        expiration_utc: new Date(Date.now() + 3600000), // 1 hour from now
      };

      const parentLogger = TraceRootLogger.create(mockConfig);
      const childLogger = parentLogger.child({ module: 'test' });

      // Child logger should not have its own credential refresh promise
      expect((childLogger as any).credentialsRefreshPromise).toBeUndefined();
      expect((childLogger as any).parentLogger).toBe(parentLogger);

      // Child logging should work through parent's credential management
      await expect(childLogger.info('Cloud message')).resolves.not.toThrow();
    });
  });

  describe('Child logger flush delegation', () => {
    test('child logger flush should delegate to root logger', async () => {
      const parentLogger = TraceRootLogger.create(mockConfig);
      const childLogger = parentLogger.child({ module: 'test' });
      const grandchildLogger = childLogger.child({ operation: 'login' });

      // Mock parent flush method
      const parentFlushSpy = jest.spyOn(parentLogger, 'flush').mockResolvedValue();

      // Child flush should delegate to parent
      await grandchildLogger.flush();

      expect(parentFlushSpy).toHaveBeenCalledTimes(1);

      parentFlushSpy.mockRestore();
    });

    test('deeply nested child logger should delegate flush to root', async () => {
      const rootLogger = TraceRootLogger.create(mockConfig);
      const child1 = rootLogger.child({ l1: 'v1' });
      const child2 = child1.child({ l2: 'v2' });
      const child3 = child2.child({ l3: 'v3' });
      const child4 = child3.child({ l4: 'v4' });

      // Mock root flush method
      const rootFlushSpy = jest.spyOn(rootLogger, 'flush').mockResolvedValue();

      // Deep child flush should delegate to root
      await child4.flush();

      expect(rootFlushSpy).toHaveBeenCalledTimes(1);

      rootFlushSpy.mockRestore();
    });
  });

  describe('Child logger level consistency', () => {
    test('all child loggers at different levels should have consistent log behavior', async () => {
      const rootLogger = TraceRootLogger.create(mockConfig);
      const serviceLogger = rootLogger.child({ service: 'auth' });
      const moduleLogger = serviceLogger.child({ module: 'login' });
      const operationLogger = moduleLogger.child({ operation: 'validate' });

      // Clear mock call history after all loggers are created
      mockWinstonLogger.debug.mockClear();

      // All should log debug messages since level is hardcoded to debug
      await rootLogger.debug('Root debug');
      await serviceLogger.debug('Service debug');
      await moduleLogger.debug('Module debug');
      await operationLogger.debug('Operation debug');

      // Each logger method calls winston twice (local mode + cloud mode check)
      // So 4 debug calls * 2 = 8 total calls
      expect(mockWinstonLogger.debug).toHaveBeenCalledTimes(8);

      // Verify that each logger called debug with appropriate context
      // Note: Each debug() call results in two winston calls, so we check specific ones

      // Root logger calls (1st and 2nd winston calls)
      expect(mockWinstonLogger.debug).toHaveBeenCalledWith(
        'Root debug',
        expect.objectContaining({
          stack_trace: expect.any(String),
        })
      );

      // Service logger calls (3rd and 4th winston calls)
      expect(mockWinstonLogger.debug).toHaveBeenCalledWith(
        'Service debug',
        expect.objectContaining({
          service: 'auth',
          stack_trace: expect.any(String),
        })
      );

      // Module logger calls (5th and 6th winston calls)
      expect(mockWinstonLogger.debug).toHaveBeenCalledWith(
        'Module debug',
        expect.objectContaining({
          service: 'auth',
          module: 'login',
          stack_trace: expect.any(String),
        })
      );

      // Operation logger calls (7th and 8th winston calls)
      expect(mockWinstonLogger.debug).toHaveBeenCalledWith(
        'Operation debug',
        expect.objectContaining({
          service: 'auth',
          module: 'login',
          operation: 'validate',
          stack_trace: expect.any(String),
        })
      );
    });
  });
});
