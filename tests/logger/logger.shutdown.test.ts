/**
 * Tests for logger flush and shutdown functionality
 * Tests both synchronous and asynchronous usage patterns
 */

import * as traceroot from '../../src/index';
import { TraceRootConfig } from '../../src/config';

describe('Logger Flush and Shutdown', () => {
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
    // Initialize tracer and logger for each test
    traceroot.init(testConfig);
  });

  afterEach(async () => {
    // Clean shutdown after each test
    await traceroot.shutdownTracer();
    await traceroot.shutdownLogger();
  });

  describe('flushLogger', () => {
    test('should work synchronously (without await)', done => {
      // Get logger and create some log entries
      const logger = traceroot.getLogger();

      logger.info('Test sync log message 1');
      logger.warn('Test sync log message 2');
      logger.error('Test sync log message 3');

      // Flush synchronously (no await)
      const flushPromise = traceroot.forceFlushLogger();
      expect(flushPromise).toBeInstanceOf(Promise);

      // Should complete quickly for sync usage
      setTimeout(() => {
        done();
      }, 100);
    });

    test('should work asynchronously (with await)', async () => {
      // Get logger and create some log entries
      const logger = traceroot.getLogger();

      logger.info('Test async log message 1');
      logger.warn('Test async log message 2');
      logger.error('Test async log message 3');

      // Flush asynchronously (with await)
      await traceroot.forceFlushLogger();

      // Should complete successfully
      expect(true).toBe(true);
    });

    test('should handle large number of log messages', async () => {
      const logger = traceroot.getLogger();

      // Create many log messages
      for (let i = 0; i < 100; i++) {
        logger.info(`Bulk log message ${i}`);
      }

      // Flush should handle all messages
      await traceroot.forceFlushLogger();

      expect(true).toBe(true);
    });

    test('should handle different log levels', async () => {
      const logger = traceroot.getLogger();

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      // Flush should handle all log levels
      await traceroot.forceFlushLogger();

      expect(true).toBe(true);
    });
  });

  describe('shutdownLogger', () => {
    test('should work synchronously (without await)', done => {
      // Get logger and create some log entries
      const logger = traceroot.getLogger();

      logger.info('Pre-shutdown log message');

      // Shutdown synchronously (no await)
      const shutdownPromise = traceroot.shutdownLogger();
      expect(shutdownPromise).toBeInstanceOf(Promise);

      // Should complete quickly for sync usage
      setTimeout(() => {
        done();
      }, 200);
    });

    test('should work asynchronously (with await)', async () => {
      // Get logger and create some log entries
      const logger = traceroot.getLogger();

      logger.info('Pre-async-shutdown log message');

      // Shutdown asynchronously (with await)
      await traceroot.shutdownLogger();

      // Should complete successfully
      expect(true).toBe(true);
    });

    test('should handle errors gracefully', async () => {
      // This should not throw even if there are internal errors
      await expect(traceroot.shutdownLogger()).resolves.toBeUndefined();
    });

    test('should be idempotent (safe to call multiple times)', async () => {
      const logger = traceroot.getLogger();
      logger.info('Test message before multiple shutdowns');

      // First shutdown
      await traceroot.shutdownLogger();

      // Second shutdown should not throw
      await expect(traceroot.shutdownLogger()).resolves.toBeUndefined();
    });
  });

  describe('Combined usage', () => {
    test('should work with flush followed by shutdown (sync)', done => {
      const logger = traceroot.getLogger();

      logger.info('Combined test log message');
      logger.warn('Another combined test message');

      // Sync usage - flush then shutdown
      traceroot.forceFlushLogger();
      traceroot.shutdownLogger();

      setTimeout(() => {
        done();
      }, 300);
    });

    test('should work with flush followed by shutdown (async)', async () => {
      const logger = traceroot.getLogger();

      logger.info('Async combined test log message');
      logger.error('Another async combined test message');

      // Async usage - flush then shutdown
      await traceroot.forceFlushLogger();
      await traceroot.shutdownLogger();

      expect(true).toBe(true);
    });

    test('should handle traced function with logging', async () => {
      // Create a traced function that also logs
      const tracedFunction = traceroot.traceFunction(
        function testWithLogging() {
          const logger = traceroot.getLogger();
          logger.info('Log message from traced function');
          return 'traced result';
        },
        { spanName: 'traced-with-logging' }
      );

      const result = tracedFunction();
      expect(result).toBe('traced result');

      // Flush both tracer and logger
      await traceroot.forceFlushTracer();
      await traceroot.forceFlushLogger();

      // Shutdown both
      await traceroot.shutdownTracer();
      await traceroot.shutdownLogger();

      expect(true).toBe(true);
    });
  });

  describe('Edge cases', () => {
    test('should handle shutdown without any logs', async () => {
      // Shutdown immediately without creating any logs
      await expect(traceroot.shutdownLogger()).resolves.toBeUndefined();
    });

    test('should handle flush without any logs', async () => {
      // Flush immediately without creating any logs
      await expect(traceroot.forceFlushLogger()).resolves.toBeUndefined();
    });

    test('should handle logging after flush but before shutdown', async () => {
      const logger = traceroot.getLogger();

      logger.info('Message before flush');
      await traceroot.forceFlushLogger();

      // Should still be able to log after flush
      logger.info('Message after flush');

      await traceroot.shutdownLogger();

      expect(true).toBe(true);
    });
  });

  describe('Integration with different transport types', () => {
    test('should handle console transport', async () => {
      // Console transport should always be present in test environment
      const logger = traceroot.getLogger();

      logger.info('Console transport test message');

      await traceroot.forceFlushLogger();
      await traceroot.shutdownLogger();

      expect(true).toBe(true);
    });
  });

  describe('Performance', () => {
    test('should handle rapid flush/shutdown cycles', async () => {
      const logger = traceroot.getLogger();

      // Rapid logging and flushing
      for (let i = 0; i < 10; i++) {
        logger.info(`Rapid test message ${i}`);

        if (i % 3 === 0) {
          await traceroot.forceFlushLogger();
        }
      }

      await traceroot.shutdownLogger();
      expect(true).toBe(true);
    });
  });
});
