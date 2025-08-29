import { TraceRootLogger } from '../../src/logger';
import { TraceRootConfigImpl } from '../../src/config';

// Mock winston and related dependencies
jest.mock('winston', () => {
  const logLevels: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

  const createMockLogger = (level = 'debug') => {
    const shouldLog = (logLevel: string): boolean => {
      return logLevels[level] <= logLevels[logLevel];
    };

    return {
      debug: jest.fn().mockImplementation((message, meta) => {
        // Winston would filter based on level - if not filtered, call gets recorded
        return shouldLog('debug');
      }),
      info: jest.fn().mockImplementation((message, meta) => {
        return shouldLog('info');
      }),
      warn: jest.fn().mockImplementation((message, meta) => {
        return shouldLog('warn');
      }),
      error: jest.fn().mockImplementation((message, meta) => {
        return shouldLog('error');
      }),
      add: jest.fn(),
      on: jest.fn(),
      remove: jest.fn(),
      transports: [],
      level: level,
    };
  };

  // Default mock logger for when specific level isn't known
  const mockLogger = createMockLogger('debug');

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
    createLogger: jest.fn(config => {
      // Create a logger with the specified level from the config
      return createMockLogger(config?.level || 'debug');
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

describe('TraceRoot Logger Log Level Configuration', () => {
  let mockConfig: TraceRootConfigImpl;

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
      _name: 'test-logger',
      _sub_name: 'test-sub-logger',
    };
  });

  describe('Current hardcoded log level behavior', () => {
    test('should use configured debug level by default', () => {
      TraceRootLogger.create(mockConfig);
      const winston = require('winston');

      // Check that winston.createLogger was called with configured debug level
      expect(winston.createLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug', // From config.log_level
        })
      );
    });

    test('should log debug messages with configured level', async () => {
      const logger = TraceRootLogger.create(mockConfig);

      // Should not throw
      await expect(logger.debug('Debug message')).resolves.not.toThrow();
    });

    test('should log all levels with current debug level', async () => {
      const logger = TraceRootLogger.create(mockConfig);

      // All should work without throwing
      await expect(logger.debug('Debug message')).resolves.not.toThrow();
      await expect(logger.info('Info message')).resolves.not.toThrow();
      await expect(logger.warn('Warn message')).resolves.not.toThrow();
      await expect(logger.error('Error message')).resolves.not.toThrow();
      await expect(logger.critical('Critical message')).resolves.not.toThrow();
    });
  });

  describe('Console export with hardcoded levels', () => {
    test('should create console logger with hardcoded debug level when console export enabled', () => {
      mockConfig.enable_log_console_export = true;

      const logger = TraceRootLogger.create(mockConfig);
      const consoleLogger = (logger as any).consoleLogger;

      expect(consoleLogger).toBeDefined();
      expect(consoleLogger).not.toBeNull();
    });

    test('should not create console logger when console export disabled', () => {
      mockConfig.enable_log_console_export = false;

      const logger = TraceRootLogger.create(mockConfig);
      const consoleLogger = (logger as any).consoleLogger;

      expect(consoleLogger).toBeNull();
    });
  });

  describe('CloudWatch transport with hardcoded levels', () => {
    test('should use hardcoded debug level for CloudWatch transport', () => {
      mockConfig.local_mode = false;
      mockConfig.enable_log_cloud_export = true;

      // Mock AWS credentials
      (mockConfig as any)._awsCredentials = {
        aws_access_key_id: 'test-key',
        aws_secret_access_key: 'test-secret',
        aws_session_token: 'test-token',
        region: 'us-east-1',
      };

      const WinstonCloudWatch = require('winston-cloudwatch');
      TraceRootLogger.create(mockConfig);

      // Check that CloudWatch transport was created with hardcoded debug level
      expect(WinstonCloudWatch).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug', // Currently hardcoded
        })
      );
    });
  });

  describe('Child logger level inheritance', () => {
    test('child logger should inherit parent logger level configuration', async () => {
      const parentLogger = TraceRootLogger.create(mockConfig);
      const childLogger = parentLogger.child({ module: 'auth' });

      // Child should share the same winston logger instance as parent
      expect((childLogger as any).logger).toBe((parentLogger as any).logger);

      // Both should work without throwing
      await expect(childLogger.debug('Child debug message')).resolves.not.toThrow();
      await expect(childLogger.info('Child info message')).resolves.not.toThrow();
    });

    test('nested child loggers should inherit root logger level configuration', async () => {
      const parentLogger = TraceRootLogger.create(mockConfig);
      const childLogger = parentLogger.child({ service: 'auth' });
      const grandchildLogger = childLogger.child({ module: 'login' });

      // All should share the same winston logger instance
      expect((grandchildLogger as any).logger).toBe((parentLogger as any).logger);

      // Should work without throwing
      await expect(grandchildLogger.warn('Nested child warning')).resolves.not.toThrow();
    });

    test('child logger should share console logger with parent', () => {
      mockConfig.enable_log_console_export = true;

      const parentLogger = TraceRootLogger.create(mockConfig);
      const childLogger = parentLogger.child({ module: 'test' });

      const parentConsoleLogger = (parentLogger as any).consoleLogger;
      const childConsoleLogger = (childLogger as any).consoleLogger;

      expect(parentConsoleLogger).toBeDefined();
      expect(childConsoleLogger).toBe(parentConsoleLogger); // Should be the same instance
    });
  });

  describe('Configurable log level support', () => {
    test('should configure winston logger with INFO level', () => {
      const configWithLogLevel = {
        ...mockConfig,
        log_level: 'info' as const,
      };

      jest.clearAllMocks();
      const winston = require('winston');

      TraceRootLogger.create(configWithLogLevel);

      // Verify winston.createLogger was called with INFO level
      expect(winston.createLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
        })
      );
    });

    test('should configure winston logger with WARN level', () => {
      const configWithLogLevel = {
        ...mockConfig,
        log_level: 'warn' as const,
      };

      jest.clearAllMocks();
      const winston = require('winston');

      TraceRootLogger.create(configWithLogLevel);

      // Verify winston.createLogger was called with WARN level
      expect(winston.createLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
        })
      );
    });

    test('should configure winston logger with ERROR level', () => {
      const configWithLogLevel = {
        ...mockConfig,
        log_level: 'error' as const,
      };

      jest.clearAllMocks();
      const winston = require('winston');

      TraceRootLogger.create(configWithLogLevel);

      // Verify winston.createLogger was called with ERROR level
      expect(winston.createLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
        })
      );
    });

    test('should configure winston logger with SILENT level', () => {
      const configWithLogLevel = {
        ...mockConfig,
        log_level: 'silent' as const,
      };

      jest.clearAllMocks();
      const winston = require('winston');

      TraceRootLogger.create(configWithLogLevel);

      // Verify winston.createLogger was called with SILENT level
      expect(winston.createLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'silent',
        })
      );
    });

    test('child logger should inherit parent log level configuration', () => {
      const configWithLogLevel = {
        ...mockConfig,
        log_level: 'warn' as const,
      };

      const parentLogger = TraceRootLogger.create(configWithLogLevel);
      const childLogger = parentLogger.child({ module: 'auth' });

      // Child logger should have same config as parent
      expect((childLogger as any).config.log_level).toBe('warn');

      // Child logger should share same winston logger instance
      expect((childLogger as any).logger).toBe((parentLogger as any).logger);
    });
  });

  describe('getLogger with log level override', () => {
    test('should override log level when specified in getLogger call', async () => {
      // Set up global logger with DEBUG level by using initializeLogger
      const { initializeLogger, getLogger } = require('../../src/logger');
      const globalConfig = {
        ...mockConfig,
        log_level: 'debug' as const,
      };

      // Initialize global logger
      initializeLogger(globalConfig);

      // Get logger with WARN level override - should be different instance
      const overrideLogger = getLogger(undefined, 'warn');
      const globalLogger = getLogger();

      // This should be a new logger instance, not the global one
      expect(overrideLogger).not.toBe(globalLogger);

      // Both should work without throwing
      await expect(overrideLogger.warn('Test warn message')).resolves.not.toThrow();
      await expect(globalLogger.debug('Test debug message')).resolves.not.toThrow();
    });

    test('should return global logger when no log level override provided', async () => {
      const { initializeLogger, getLogger } = require('../../src/logger');
      const globalConfig = {
        ...mockConfig,
        log_level: 'info' as const,
      };

      // Initialize global logger
      const globalLogger = initializeLogger(globalConfig);

      // Get logger without override
      const retrievedLogger = getLogger();

      // Should be the same instance as global logger
      expect(retrievedLogger).toBe(globalLogger);
    });

    test('child logger from override logger should inherit override log level', async () => {
      const { initializeLogger, getLogger } = require('../../src/logger');
      const globalConfig = {
        ...mockConfig,
        log_level: 'debug' as const,
      };

      // Initialize global logger
      initializeLogger(globalConfig);

      // Get logger with ERROR level override
      const errorLogger = getLogger(undefined, 'error');
      const childLogger = errorLogger.child({ module: 'test' });

      // Child should not throw and should work properly
      await expect(childLogger.error('Child error message')).resolves.not.toThrow();

      // Verify it's properly configured
      expect((childLogger as any).config.log_level).toBe('error');
    });
  });
});
