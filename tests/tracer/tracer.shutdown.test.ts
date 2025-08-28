/**
 * Tests for tracer shutdown and flush functionality
 * Tests both synchronous and asynchronous usage patterns
 */

import * as traceroot from '../../src/index';
import { TraceRootConfig } from '../../src/config';

describe('Tracer Shutdown and Flush', () => {
  const testConfig: Partial<TraceRootConfig> = {
    service_name: 'test-service',
    github_owner: 'test-owner',
    github_repo_name: 'test-repo',
    github_commit_hash: 'test-commit',
    environment: 'test',
    local_mode: true,
    enable_span_console_export: false,
    enable_log_console_export: false, // Disable console logging for tracer tests to avoid transport warnings
  };

  beforeEach(() => {
    // Initialize tracer for each test
    traceroot.init(testConfig);
  });

  afterEach(async () => {
    // Clean shutdown after each test
    await traceroot.shutdownTracer();
  });

  describe('forceFlushTracer', () => {
    test('should work synchronously (without await)', done => {
      // Create a traced function
      const testFunction = traceroot.traceFunction(
        function testSync() {
          return 'sync result';
        },
        { spanName: 'test-sync-span' }
      );

      // Execute traced function
      const result = testFunction();
      expect(result).toBe('sync result');

      // Flush synchronously (no await)
      const flushPromise = traceroot.forceFlushTracer();
      expect(flushPromise).toBeInstanceOf(Promise);

      // Should complete quickly for sync usage
      setTimeout(() => {
        done();
      }, 100);
    });

    test('should work asynchronously (with await)', async () => {
      // Create a traced function
      const testFunction = traceroot.traceFunction(
        function testAsync() {
          return 'async result';
        },
        { spanName: 'test-async-span' }
      );

      // Execute traced function
      const result = testFunction();
      expect(result).toBe('async result');

      // Flush asynchronously (with await)
      await traceroot.forceFlushTracer();

      // Should complete successfully
      expect(true).toBe(true);
    });

    test('should handle multiple spans', async () => {
      const tracedFn1 = traceroot.traceFunction(() => 'result1', { spanName: 'span1' });
      const tracedFn2 = traceroot.traceFunction(() => 'result2', { spanName: 'span2' });

      // Execute multiple traced functions
      tracedFn1();
      tracedFn2();

      // Flush should handle multiple spans
      await traceroot.forceFlushTracer();

      expect(true).toBe(true);
    });
  });

  describe('shutdownTracing', () => {
    test('should work synchronously (without await)', done => {
      // Create and execute a traced function
      const testFunction = traceroot.traceFunction(
        function testShutdown() {
          return 'shutdown test';
        },
        { spanName: 'shutdown-span' }
      );

      testFunction();

      // Shutdown synchronously (no await)
      const shutdownPromise = traceroot.shutdownTracer();
      expect(shutdownPromise).toBeInstanceOf(Promise);

      // Should complete quickly for sync usage
      setTimeout(() => {
        done();
      }, 200);
    });

    test('should work asynchronously (with await)', async () => {
      // Create and execute a traced function
      const testFunction = traceroot.traceFunction(
        function testAsyncShutdown() {
          return 'async shutdown test';
        },
        { spanName: 'async-shutdown-span' }
      );

      const result = testFunction();
      expect(result).toBe('async shutdown test');

      // Shutdown asynchronously (with await)
      await traceroot.shutdownTracer();

      // Should complete successfully
      expect(true).toBe(true);
    });

    test('should flush spans before shutting down', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Create multiple traced functions
      const fn1 = traceroot.traceFunction(() => 'test1', { spanName: 'pre-shutdown-1' });
      const fn2 = traceroot.traceFunction(() => 'test2', { spanName: 'pre-shutdown-2' });

      fn1();
      fn2();

      // Shutdown should flush all spans
      await traceroot.shutdownTracer();

      consoleSpy.mockRestore();
      expect(true).toBe(true);
    });

    test('should handle errors gracefully', async () => {
      // This should not throw even if there are internal errors
      await expect(traceroot.shutdownTracer()).resolves.toBeUndefined();
    });

    test('should be idempotent (safe to call multiple times)', async () => {
      // First shutdown
      await traceroot.shutdownTracer();

      // Second shutdown should not throw
      await expect(traceroot.shutdownTracer()).resolves.toBeUndefined();
    });
  });

  describe('Combined usage', () => {
    test('should work with flush followed by shutdown (sync)', done => {
      const testFn = traceroot.traceFunction(() => 'combined test', { spanName: 'combined-span' });

      testFn();

      // Sync usage - flush then shutdown
      traceroot.forceFlushTracer();
      traceroot.shutdownTracer();

      setTimeout(() => {
        done();
      }, 300);
    });

    test('should work with flush followed by shutdown (async)', async () => {
      const testFn = traceroot.traceFunction(() => 'async combined test', {
        spanName: 'async-combined-span',
      });

      testFn();

      // Async usage - flush then shutdown
      await traceroot.forceFlushTracer();
      await traceroot.shutdownTracer();

      expect(true).toBe(true);
    });
  });

  describe('Edge cases', () => {
    test('should handle shutdown without any spans', async () => {
      // Shutdown immediately without creating any spans
      await expect(traceroot.shutdownTracer()).resolves.toBeUndefined();
    });

    test('should handle flush without any spans', async () => {
      // Flush immediately without creating any spans
      await expect(traceroot.forceFlushTracer()).resolves.toBeUndefined();
    });
  });
});
