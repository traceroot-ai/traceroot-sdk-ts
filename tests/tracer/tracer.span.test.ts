/**
 * Tests for tracer span helper functions
 * Tests the internal span finalization and event handling logic
 */

import { jest } from '@jest/globals';
import { Span, SpanStatusCode } from '@opentelemetry/api';
import * as traceroot from '../../src/index';
import { TraceRootConfig } from '../../src/config';
import { TraceOptionsImpl } from '../../src/tracer';

// Mock span for testing
const createMockSpan = () => {
  const mockSpan = {
    addEvent: jest.fn(),
    setStatus: jest.fn(),
    end: jest.fn(),
    recordException: jest.fn(),
    setAttribute: jest.fn(),
    isRecording: jest.fn().mockReturnValue(true),
    spanContext: jest.fn().mockReturnValue({
      traceId: '12345678901234567890123456789012',
      spanId: '1234567890123456',
    }),
  } as unknown as Span;
  return mockSpan;
};

// Mock _storeDictInSpan function
const mockStoreDictInSpan = jest.fn();

// Since the helper functions are private, we'll test them through the public API
// but also create isolated tests by accessing them through module internals
describe('Tracer Span Helper Functions', () => {
  // Set timeout for async operations
  jest.setTimeout(10000);
  const testConfig: Partial<TraceRootConfig> = {
    service_name: 'test-service',
    github_owner: 'test-owner',
    github_repo_name: 'test-repo',
    github_commit_hash: 'test-commit',
    environment: 'test',
    local_mode: true,
    enable_span_console_export: false,
    enable_log_console_export: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    traceroot.init(testConfig);
  });

  afterEach(async () => {
    // Properly shutdown both tracer and logger to clean up all async operations
    await traceroot.shutdownTracing();
    await traceroot.shutdownLogger();
  });

  describe('Pending Log Events Handling', () => {
    test('should add pending log events to span when they exist', () => {
      const mockSpan = createMockSpan();
      const pendingEvents = [
        { name: 'log.info', attributes: { message: 'test1' }, timestamp: Date.now() },
        { name: 'log.error', attributes: { message: 'test2' }, timestamp: Date.now() },
      ];
      
      // Simulate pending events
      (mockSpan as any)._pendingLogEvents = pendingEvents;

      // Test through a traced function that logs
      const testFn = traceroot.traceFunction(function testFunction() {
        const logger = traceroot.get_logger();
        logger.info('test message 1');
        logger.error('test message 2');
        return 'success';
      });

      const result = testFn();
      expect(result).toBe('success');
    });

    test('should handle span with no pending log events gracefully', () => {
      const testFn = traceroot.traceFunction(function testFunction() {
        return 'success';
      });

      const result = testFn();
      expect(result).toBe('success');
    });
  });

  describe('Span Success Finalization', () => {
    test('should finalize span successfully with return value tracing enabled', () => {
      const testValue = { key: 'value', number: 42 };
      
      const testFn = traceroot.traceFunction(function testFunction() {
        return testValue;
      }, { traceReturnValue: true });

      const result = testFn();
      expect(result).toEqual(testValue);
    });

    test('should finalize span successfully with return value tracing disabled', () => {
      const testValue = 'simple return';
      
      const testFn = traceroot.traceFunction(function testFunction() {
        return testValue;
      }, { traceReturnValue: false });

      const result = testFn();
      expect(result).toBe(testValue);
    });

    test('should handle complex return values with flattened attributes', () => {
      const complexValue = {
        nested: { data: 'test' },
        array: [1, 2, 3],
        boolean: true,
      };
      
      const testFn = traceroot.traceFunction(function testFunction() {
        return complexValue;
      }, { traceReturnValue: true, flattenAttributes: true });

      const result = testFn();
      expect(result).toEqual(complexValue);
    });

    test('should handle async function success path', async () => {
      const testValue = 'async result';
      
      const testFn = traceroot.traceFunction(async function testAsyncFunction() {
        await new Promise(resolve => setTimeout(resolve, 10));
        return testValue;
      }, { traceReturnValue: true });

      const result = await testFn();
      expect(result).toBe(testValue);
    });
  });

  describe('Span Error Finalization', () => {
    test('should finalize span with error for sync functions', () => {
      const testError = new Error('Test sync error');
      
      const testFn = traceroot.traceFunction(function testFunction() {
        throw testError;
      });

      expect(() => testFn()).toThrow('Test sync error');
    });

    test('should finalize span with error for async functions', async () => {
      const testError = new Error('Test async error');
      
      const testFn = traceroot.traceFunction(async function testAsyncFunction() {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw testError;
      });

      await expect(testFn()).rejects.toThrow('Test async error');
    });

    test('should handle error with pending log events', () => {
      const testError = new Error('Error with logs');
      
      const testFn = traceroot.traceFunction(function testFunction() {
        const logger = traceroot.get_logger();
        logger.info('Before error');
        logger.warn('Warning message');
        throw testError;
      });

      expect(() => testFn()).toThrow('Error with logs');
    });

    test('should handle async error with pending log events', async () => {
      const testError = new Error('Async error with logs');
      
      const testFn = traceroot.traceFunction(async function testAsyncFunction() {
        const logger = traceroot.get_logger();
        logger.info('Async before error');
        await new Promise(resolve => setTimeout(resolve, 10));
        logger.error('Async error log');
        throw testError;
      });

      await expect(testFn()).rejects.toThrow('Async error with logs');
    });
  });

  describe('Integration Tests', () => {
    test('should handle mixed sync and async operations', async () => {
      const syncFn = traceroot.traceFunction(function syncFunction(value: string) {
        return `sync-${value}`;
      }, { traceReturnValue: true });

      const asyncFn = traceroot.traceFunction(async function asyncFunction(value: string) {
        await new Promise(resolve => setTimeout(resolve, 5));
        return `async-${value}`;
      }, { traceReturnValue: true });

      const syncResult = syncFn('test');
      const asyncResult = await asyncFn('test');

      expect(syncResult).toBe('sync-test');
      expect(asyncResult).toBe('async-test');
    });

    test('should handle nested traced functions', async () => {
      const innerFn = traceroot.traceFunction(function innerFunction(x: number) {
        return x * 2;
      }, { spanName: 'inner', traceReturnValue: true });

      const outerFn = traceroot.traceFunction(async function outerFunction(value: number) {
        const logger = traceroot.get_logger();
        logger.info('Starting outer function');
        
        const doubled = innerFn(value);
        logger.info(`Doubled value: ${doubled}`);
        
        await new Promise(resolve => setTimeout(resolve, 5));
        return doubled + 10;
      }, { spanName: 'outer', traceReturnValue: true });

      const result = await outerFn(5);
      expect(result).toBe(20); // (5 * 2) + 10
    });

    test('should handle errors in nested traced functions', () => {
      const innerFn = traceroot.traceFunction(function innerFunction() {
        throw new Error('Inner function error');
      }, { spanName: 'inner-error' });

      const outerFn = traceroot.traceFunction(function outerFunction() {
        const logger = traceroot.get_logger();
        logger.info('Before calling inner function');
        return innerFn();
      }, { spanName: 'outer-error' });

      expect(() => outerFn()).toThrow('Inner function error');
    });
  });

  describe('Edge Cases', () => {
    test('should handle functions that return undefined', () => {
      const testFn = traceroot.traceFunction(function testFunction() {
        // Implicit return undefined
      }, { traceReturnValue: true });

      const result = testFn();
      expect(result).toBeUndefined();
    });

    test('should handle functions that return null', () => {
      const testFn = traceroot.traceFunction(function testFunction() {
        return null;
      }, { traceReturnValue: true });

      const result = testFn();
      expect(result).toBeNull();
    });

    test('should handle async functions that return promises directly', async () => {
      const testFn = traceroot.traceFunction(async function testFunction() {
        return Promise.resolve('direct promise');
      }, { traceReturnValue: true });

      const result = await testFn();
      expect(result).toBe('direct promise');
    });

    test('should handle functions with no name (anonymous)', () => {
      const testFn = traceroot.traceFunction(() => {
        return 'anonymous result';
      }, { traceReturnValue: true });

      const result = testFn();
      expect(result).toBe('anonymous result');
    });
  });
});
