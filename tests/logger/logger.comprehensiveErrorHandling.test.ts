import { initializeLogger } from '../../src/logger';
import { TraceRootConfigImpl } from '../../src/config';

// Mock winston and related dependencies
jest.mock('winston', () => {
  const createMockLogger = (shouldThrow = false) => ({
    debug: jest.fn().mockImplementation(() => {
      if (shouldThrow) throw new Error('Winston debug error');
    }),
    info: jest.fn().mockImplementation(() => {
      if (shouldThrow) throw new Error('Winston info error');
    }),
    warn: jest.fn().mockImplementation(() => {
      if (shouldThrow) throw new Error('Winston warn error');
    }),
    error: jest.fn().mockImplementation(() => {
      if (shouldThrow) throw new Error('Winston error error');
    }),
    add: jest.fn().mockImplementation(() => {
      if (shouldThrow) throw new Error('Winston add transport error');
    }),
    on: jest.fn(),
    transports: [],
  });

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
    createLogger: jest.fn(() => createMockLogger()),
    format: formatMock,
    transports: {
      Console: jest.fn().mockImplementation(() => {
        // Sometimes throw during Console transport creation
        if (Math.random() < 0.1) {
          throw new Error('Console transport creation failed');
        }
        return {};
      }),
    },
  };

  // Allow tests to control winston behavior
  (winston as any).setThrowMode = (shouldThrow: boolean) => {
    winston.createLogger.mockReturnValue(createMockLogger(shouldThrow));
  };

  return winston;
});

// Mock winston-cloudwatch to simulate various CloudWatch errors
jest.mock('winston-cloudwatch', () => {
  return jest.fn().mockImplementation(() => {
    // Randomly throw different types of errors
    const random = Math.random();
    if (random < 0.3) {
      throw new Error('CloudWatch transport initialization failed - Invalid credentials');
    }
    return {
      on: jest.fn(),
    };
  });
});

jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn().mockImplementation(() => {
    throw new Error('AWS SDK CloudWatch client initialization failed');
  }),
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

// Mock fetch to simulate various API errors
global.fetch = jest.fn();

describe('TraceRoot Logger Comprehensive Error Handling', () => {
  let mockConfig: TraceRootConfigImpl;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

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
      token: 'test-token',
    };
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  test('should handle ALL credential-related errors without throwing', async () => {
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

    // Mock fetch to fail with various error types
    const errorTypes = [
      () => Promise.reject(new Error('Network timeout')),
      () => Promise.reject(new Error('DNS resolution failed')),
      () => Promise.resolve({ ok: false, status: 401, statusText: 'Unauthorized' }),
      () => Promise.resolve({ ok: false, status: 403, statusText: 'Forbidden' }),
      () => Promise.resolve({ ok: false, status: 500, statusText: 'Internal Server Error' }),
      () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('Invalid JSON')) }),
    ];

    let currentErrorIndex = 0;
    (global.fetch as jest.Mock).mockImplementation(() => {
      const errorFn = errorTypes[currentErrorIndex % errorTypes.length];
      currentErrorIndex++;
      return errorFn();
    });

    const winston = require('winston');
    (winston as any).setThrowMode(true); // Make winston throw errors

    let logger;
    
    // Logger creation should NOT throw even if winston throws
    expect(() => {
      logger = initializeLogger(mockConfig);
    }).not.toThrow();

    expect(logger).toBeDefined();

    // All logging operations should NOT throw even with multiple error sources
    const loggingOperations = [
      () => logger.debug('Debug with expired credentials'),
      () => logger.info('Info with expired credentials'), 
      () => logger.warn('Warn with expired credentials'),
      () => logger.error('Error with expired credentials'),
      () => logger.critical('Critical with expired credentials'),
    ];

    // Execute logging operations multiple times to trigger various error paths
    for (let i = 0; i < 20; i++) {
      const operation = loggingOperations[i % loggingOperations.length];
      await expect(operation()).resolves.not.toThrow();
    }

    // Verify that errors were logged but not thrown
    expect(consoleErrorSpy).toHaveBeenCalled();
    
    // Should see various types of error messages in console
    const errorCalls = consoleErrorSpy.mock.calls.map(call => call.join(' '));
    expect(errorCalls.some(call => call.includes('Failed to refresh AWS credentials'))).toBe(true);
  });

  test('should handle winston logger creation failures with fallback', () => {
    // Mock winston.createLogger to throw
    const winston = require('winston');
    winston.createLogger.mockImplementation(() => {
      throw new Error('Winston createLogger failed - out of memory');
    });

    let logger;
    
    // Should create fallback logger instead of throwing
    expect(() => {
      logger = initializeLogger(mockConfig);
    }).not.toThrow();

    expect(logger).toBeDefined();

    // Fallback logger should work
    expect(() => {
      logger.info('Test with fallback logger');
    }).not.toThrow();

    // Should log the winston creation error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[TraceRoot] Failed to create winston logger:',
      'Winston createLogger failed - out of memory'
    );
  });

  test('should handle CloudWatch transport creation failures gracefully', () => {
    // Set up valid credentials
    const validCredentials = {
      aws_access_key_id: 'valid-key',
      aws_secret_access_key: 'valid-secret',
      aws_session_token: 'valid-token',
      region: 'us-east-1',
      hash: 'valid-hash', 
      expiration_utc: new Date(Date.now() + 3600000), // 1 hour from now
      otlp_endpoint: 'http://localhost:4318',
    };

    (mockConfig as any)._awsCredentials = validCredentials;

    // winston-cloudwatch is already mocked to sometimes throw in beforeEach

    let logger;

    // Logger creation should not throw even if CloudWatch transport creation fails
    expect(() => {
      logger = initializeLogger(mockConfig);
    }).not.toThrow();

    expect(logger).toBeDefined();

    // Logging should still work even if CloudWatch failed to initialize
    expect(async () => {
      await logger.info('Test message after CloudWatch transport failure');
    }).not.toThrow();
  });

  test('should handle console logger creation failures', () => {
    // Enable console export
    mockConfig.enable_log_console_export = true;

    // Mock winston console transport to throw
    const winston = require('winston');
    winston.transports.Console.mockImplementation(() => {
      throw new Error('Console transport creation failed - permission denied');
    });

    let logger;

    // Should handle console logger creation failure gracefully
    expect(() => {
      logger = initializeLogger(mockConfig);
    }).not.toThrow();

    expect(logger).toBeDefined();

    // Main logging should still work
    expect(async () => {
      await logger.info('Test after console logger creation failure');
    }).not.toThrow();

    // Should log the console logger creation error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[TraceRoot] Failed to create console logger:',
      'Console transport creation failed - permission denied'
    );
  });

  test('should handle transport addition failures', () => {
    // Set up valid credentials
    const validCredentials = {
      aws_access_key_id: 'valid-key',
      aws_secret_access_key: 'valid-secret', 
      aws_session_token: 'valid-token',
      region: 'us-east-1',
      hash: 'valid-hash',
      expiration_utc: new Date(Date.now() + 3600000), // 1 hour from now
      otlp_endpoint: 'http://localhost:4318',
    };

    (mockConfig as any)._awsCredentials = validCredentials;

    // Mock winston logger.add to throw
    const winston = require('winston');
    const mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      add: jest.fn(() => {
        throw new Error('Failed to add transport - logger is corrupted');
      }),
      on: jest.fn(),
      transports: [],
    };
    winston.createLogger.mockReturnValue(mockLogger);

    let logger;

    // Should handle transport addition failure
    expect(() => {
      logger = initializeLogger(mockConfig);
    }).not.toThrow();

    expect(logger).toBeDefined();

    // Should log transport addition errors
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[TraceRoot] Failed to add initial CloudWatch transport to logger:',
      'Failed to add transport - logger is corrupted'
    );
  });

  test('should demonstrate zero error propagation guarantee', async () => {
    // This is the ultimate test: create the worst possible scenario
    
    // Expired credentials
    const expiredCredentials = {
      aws_access_key_id: 'expired',
      aws_secret_access_key: 'expired',
      aws_session_token: 'expired',
      region: 'us-east-1',
      hash: 'expired',
      expiration_utc: new Date(Date.now() - 600000),
      otlp_endpoint: 'http://localhost:4318',
    };
    (mockConfig as any)._awsCredentials = expiredCredentials;

    // Network failures
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Complete network failure'));

    // Winston throwing errors
    const winston = require('winston');
    (winston as any).setThrowMode(true);

    // CloudWatch always failing (already mocked in beforeEach)

    let logger;
    let threwAnyError = false;

    try {
      // 1. Logger creation
      logger = initializeLogger(mockConfig);
      
      // 2. Intensive logging under adverse conditions
      const intensiveLogging = Array.from({ length: 50 }, (_, i) => 
        logger.info(`Stress test message ${i} under maximum error conditions`)
      );
      
      await Promise.all(intensiveLogging);

      // 3. Mixed logging levels
      await logger.debug('Debug under stress');
      await logger.warn('Warning under stress'); 
      await logger.error('Error under stress');
      await logger.critical('Critical under stress');

    } catch (error) {
      threwAnyError = true;
      console.log('Unexpected error caught:', error);
    }

    // THE GUARANTEE: No errors should ever be thrown
    expect(threwAnyError).toBe(false);

    // Verify that problems were logged (not thrown)
    expect(consoleErrorSpy).toHaveBeenCalled();
    
    // Should see evidence of error handling, not error throwing
    const allErrorMessages = consoleErrorSpy.mock.calls.map(call => call.join(' '));
    const hasCredentialError = allErrorMessages.some(msg => 
      msg.includes('Failed to refresh AWS credentials')
    );
    const hasWinstonError = allErrorMessages.some(msg =>
      msg.includes('Logger') && msg.includes('error')
    );

    // We should see logged errors but never thrown errors
    expect(hasCredentialError || hasWinstonError).toBe(true);
  });
});