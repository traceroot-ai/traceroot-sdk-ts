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
    kthxbye: jest.fn(callback => callback()), // Mock flush method with immediate callback
  }));
});

jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn(),
  CreateLogGroupCommand: jest.fn(),
  CreateLogStreamCommand: jest.fn(),
  DescribeLogGroupsCommand: jest.fn(),
  DescribeLogStreamsCommand: jest.fn(),
}));

// Mock OpenTelemetry with a span that has setAttributes method
const mockSpan = {
  isRecording: jest.fn(() => true),
  setAttributes: jest.fn(),
  addEvent: jest.fn(),
  spanContext: jest.fn(() => ({
    traceId: '12345678901234567890123456789012',
    spanId: '1234567890123456',
  })),
};

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: jest.fn(() => mockSpan),
  },
}));

describe('TraceRoot Logger Nested Object Serialization', () => {
  let logger: TraceRootLogger;
  let mockConfig: TraceRootConfigImpl;
  let mockWinstonLogger: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    mockConfig = {
      service_name: 'test-service',
      local_mode: true, // Enable local mode to trigger span attribute processing
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
      log_level: 'debug',
      _name: 'test-logger',
      _sub_name: 'test-sub-logger',
    };

    logger = TraceRootLogger.create(mockConfig);

    // Get reference to the mocked winston logger
    const winston = require('winston');
    mockWinstonLogger = winston.createLogger();
  });

  describe('Nested Object Serialization', () => {
    test('should serialize nested objects to JSON strings instead of [object Object]', () => {
      const nestedMetadata = {
        context: {
          req: {
            id: 'req-789',
            method: 'POST',
            path: '/api/users',
            headers: {
              'content-type': 'application/json',
              'user-agent': 'test-agent',
            },
          },
          user: {
            id: 'user-123',
            profile: {
              name: 'John Doe',
              preferences: {
                theme: 'dark',
                notifications: true,
              },
            },
          },
        },
      };

      logger.info(nestedMetadata, 'Testing nested object serialization');

      // Verify that the winston logger receives the original object structure
      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Testing nested object serialization',
        expect.objectContaining({
          context: nestedMetadata.context,
          stack_trace: expect.any(String),
        })
      );

      // Verify that span attributes receive JSON-serialized versions
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          'log.metadata.context': JSON.stringify(nestedMetadata.context),
        })
      );
    });

    test('should handle mixed primitive and nested data types', () => {
      const mixedData = {
        simple: 'value',
        number: 42,
        boolean: true,
        nested: {
          deep: {
            object: 'value',
            array: [1, 2, { nested: 'in array' }],
          },
        },
        array: ['item1', 'item2', { nested: 'object in array' }],
      };

      logger.info(mixedData, 'Testing mixed data types');

      // Verify winston logger receives original objects
      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Testing mixed data types',
        expect.objectContaining({
          simple: 'value',
          number: 42,
          boolean: true,
          nested: mixedData.nested,
          array: mixedData.array,
          stack_trace: expect.any(String),
        })
      );

      // Verify span attributes serialize complex types to JSON
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          'log.metadata.simple': 'value',
          'log.metadata.number': 42,
          'log.metadata.boolean': true,
          'log.metadata.nested': JSON.stringify(mixedData.nested),
          'log.metadata.array': JSON.stringify(mixedData.array),
        })
      );
    });

    test('should handle child logger with nested context', () => {
      const childContext = {
        requestContext: {
          id: 'req-123',
          user: {
            id: 'user-456',
            role: 'admin',
          },
        },
      };

      const childLogger = logger.child(childContext);
      childLogger.info({ action: 'validation' }, 'Child logger test');

      // Verify winston logger receives merged context
      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Child logger test',
        expect.objectContaining({
          action: 'validation',
          requestContext: childContext.requestContext,
          stack_trace: expect.any(String),
        })
      );

      // Verify span attributes serialize the nested context
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          'log.metadata.action': 'validation',
          'log.metadata.requestContext': JSON.stringify(childContext.requestContext),
        })
      );
    });

    test('should handle circular references gracefully', () => {
      // Create an object with circular reference
      const circularObj: any = { name: 'test' };
      circularObj.self = circularObj;

      logger.info({ circular: circularObj }, 'Testing circular reference');

      // Verify winston logger receives the original object
      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Testing circular reference',
        expect.objectContaining({
          circular: circularObj,
          stack_trace: expect.any(String),
        })
      );

      // Verify span attributes fall back to String() for circular references
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          'log.metadata.circular': '[object Object]', // Fallback when JSON.stringify fails
        })
      );
    });

    test('should preserve null and undefined values in serialization', () => {
      const dataWithNulls = {
        validValue: 'test',
        nullValue: null,
        undefinedValue: undefined,
        nested: {
          alsoNull: null,
          alsoUndefined: undefined,
        },
      };

      logger.info(dataWithNulls, 'Testing null/undefined values');

      // Verify winston logger preserves null/undefined
      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        'Testing null/undefined values',
        expect.objectContaining({
          validValue: 'test',
          nullValue: null,
          undefinedValue: undefined,
          nested: dataWithNulls.nested,
          stack_trace: expect.any(String),
        })
      );

      // Verify span attributes serialize nested object with null/undefined
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          'log.metadata.validValue': 'test',
          'log.metadata.nested': JSON.stringify(dataWithNulls.nested),
        })
      );

      // null and undefined values should not appear in span attributes
      // (they're filtered out by the metadata processing logic)
      const spanCall = mockSpan.setAttributes.mock.calls[0][0];
      expect(spanCall).not.toHaveProperty('log.metadata.nullValue');
      expect(spanCall).not.toHaveProperty('log.metadata.undefinedValue');
    });

    test('should handle deeply nested objects correctly', () => {
      const deeplyNested = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: 'deep value',
                  array: [1, 2, { nested: true }],
                },
              },
            },
          },
        },
      };

      logger.info(deeplyNested, 'Testing deeply nested object');

      // Verify span attributes serialize the entire nested structure
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          'log.metadata.level1': JSON.stringify(deeplyNested.level1),
        })
      );

      // Verify the JSON serialization maintains the structure
      const spanCall = mockSpan.setAttributes.mock.calls[0][0];
      const serializedObject = JSON.parse(spanCall['log.metadata.level1']);
      expect(serializedObject.level2.level3.level4.level5.value).toBe('deep value');
      expect(serializedObject.level2.level3.level4.level5.array).toEqual([1, 2, { nested: true }]);
    });
  });

  describe('Backwards Compatibility', () => {
    test('should not break existing primitive value handling', () => {
      logger.info(
        {
          string: 'test',
          number: 123,
          boolean: true,
        },
        'Primitive values test'
      );

      // Primitive values should pass through unchanged to span attributes
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          'log.metadata.string': 'test',
          'log.metadata.number': 123,
          'log.metadata.boolean': true,
        })
      );
    });
  });
});
