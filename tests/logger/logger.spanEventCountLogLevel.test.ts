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
      debug: jest.fn().mockImplementation((_message, _meta) => {
        return shouldLog('debug');
      }),
      info: jest.fn().mockImplementation((_message, _meta) => {
        return shouldLog('info');
      }),
      warn: jest.fn().mockImplementation((_message, _meta) => {
        return shouldLog('warn');
      }),
      error: jest.fn().mockImplementation((_message, _meta) => {
        return shouldLog('error');
      }),
      add: jest.fn(),
      on: jest.fn(),
      remove: jest.fn(),
      transports: [],
      level: level,
    };
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
    createLogger: jest.fn(config => {
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

jest.mock('@opentelemetry/api');

describe('TraceRoot Logger Span Event Count with Log Levels', () => {
  let mockConfig: TraceRootConfigImpl;
  let mockSpan: any;
  let mockTrace: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up OpenTelemetry mocks
    mockSpan = {
      isRecording: jest.fn(() => true),
      setAttribute: jest.fn(),
      setAttributes: jest.fn(),
      addEvent: jest.fn(),
      spanContext: jest.fn(() => ({
        traceId: '12345678901234567890123456789012',
        spanId: '1234567890123456',
      })),
    };

    mockTrace = {
      getActiveSpan: jest.fn(() => mockSpan),
    };

    const otelApi = require('@opentelemetry/api');
    otelApi.trace = mockTrace;

    mockConfig = {
      service_name: 'test-service',
      local_mode: false,
      enable_log_console_export: true,
      enable_log_cloud_export: true,
      enable_span_console_export: true,
      enable_span_cloud_export: true, // Required for span event counting
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
  });

  describe('Span event counting with different log levels', () => {
    test('should count all log types when log level is debug', async () => {
      mockConfig.log_level = 'debug';
      const logger = TraceRootLogger.create(mockConfig);

      await logger.debug('Debug message');
      await logger.info('Info message');
      await logger.warn('Warn message');
      await logger.error('Error message');
      await logger.critical('Critical message');

      // All log counts should be set because debug level allows all logs
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_debug_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_info_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_warning_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_error_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_critical_logs', 1);
    });

    test('should only count info and above when log level is info', async () => {
      mockConfig.log_level = 'info';
      const logger = TraceRootLogger.create(mockConfig);

      await logger.debug('Debug message');
      await logger.info('Info message');
      await logger.warn('Warn message');
      await logger.error('Error message');
      await logger.critical('Critical message');

      // Debug should not be counted, but info and above should be
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_debug_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_info_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_warning_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_error_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_critical_logs', 1);
    });

    test('should only count warn and above when log level is warn', async () => {
      mockConfig.log_level = 'warn';
      const logger = TraceRootLogger.create(mockConfig);

      await logger.debug('Debug message');
      await logger.info('Info message');
      await logger.warn('Warn message');
      await logger.error('Error message');
      await logger.critical('Critical message');

      // Debug and info should not be counted, but warn and above should be
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_debug_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_info_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_warning_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_error_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_critical_logs', 1);
    });

    test('should only count error and above when log level is error', async () => {
      mockConfig.log_level = 'error';
      const logger = TraceRootLogger.create(mockConfig);

      await logger.debug('Debug message');
      await logger.info('Info message');
      await logger.warn('Warn message');
      await logger.error('Error message');
      await logger.critical('Critical message');

      // Only error and critical should be counted
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_debug_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_info_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_warning_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_error_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_critical_logs', 1);
    });

    test('should not count any logs when log level is silent', async () => {
      mockConfig.log_level = 'silent';
      const logger = TraceRootLogger.create(mockConfig);

      await logger.debug('Debug message');
      await logger.info('Info message');
      await logger.warn('Warn message');
      await logger.error('Error message');
      await logger.critical('Critical message');

      // No log counts should be set because silent level blocks all logs
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_debug_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_info_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_warning_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_error_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_critical_logs', 1);
    });
  });

  describe('Span event counting when both exports are disabled', () => {
    test('should not count any logs when both console and cloud exports are disabled', async () => {
      mockConfig.enable_log_console_export = false;
      mockConfig.enable_log_cloud_export = false;
      mockConfig.log_level = 'debug'; // Even with debug level, should be treated as silent
      const logger = TraceRootLogger.create(mockConfig);

      await logger.debug('Debug message');
      await logger.info('Info message');
      await logger.warn('Warn message');
      await logger.error('Error message');
      await logger.critical('Critical message');

      // No log counts should be set because both exports are disabled (treated as silent)
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_debug_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_info_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_warning_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_error_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_critical_logs', 1);
    });
  });

  describe('Span event counting when span cloud export is disabled', () => {
    test('should not count logs when enable_span_cloud_export is false', async () => {
      mockConfig.enable_span_cloud_export = false; // This should prevent counting
      mockConfig.log_level = 'debug';
      const logger = TraceRootLogger.create(mockConfig);

      await logger.debug('Debug message');
      await logger.info('Info message');
      await logger.warn('Warn message');
      await logger.error('Error message');
      await logger.critical('Critical message');

      // No log counts should be set because span cloud export is disabled
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_debug_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_info_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_warning_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_error_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_critical_logs', 1);
    });
  });

  describe('Span event counting when no active span', () => {
    test('should not count logs when there is no active span', async () => {
      // Mock getActiveSpan to return null for this test
      mockTrace.getActiveSpan.mockReturnValue(null);

      // Clear the mock before creating logger
      mockSpan.setAttribute.mockClear();

      const logger = TraceRootLogger.create(mockConfig);

      await logger.debug('Debug message');
      await logger.info('Info message');

      // setAttribute should not be called when there's no active span
      expect(mockSpan.setAttribute).not.toHaveBeenCalled();
    });

    test('should not count logs when span is not recording', async () => {
      mockSpan.isRecording.mockReturnValue(false);

      // Clear the mock before creating logger
      mockSpan.setAttribute.mockClear();

      const logger = TraceRootLogger.create(mockConfig);

      await logger.debug('Debug message');
      await logger.info('Info message');

      // setAttribute should not be called when span is not recording
      expect(mockSpan.setAttribute).not.toHaveBeenCalled();
    });
  });

  describe('Child logger span event counting', () => {
    test('child logger should inherit parent log level for span counting', async () => {
      mockConfig.log_level = 'warn';
      const parentLogger = TraceRootLogger.create(mockConfig);
      const childLogger = parentLogger.child({ module: 'auth' });

      await childLogger.debug('Debug message');
      await childLogger.info('Info message');
      await childLogger.warn('Warn message');
      await childLogger.error('Error message');

      // Only warn and above should be counted (inheriting parent's warn level)
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_debug_logs', 1);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('num_info_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_warning_logs', 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('num_error_logs', 1);
    });
  });
});
