import { TraceRootConfigImpl } from '../../src/config';
import { getLogger } from '../../src/logger';

describe('Case-insensitive log levels', () => {
  describe('TraceRootConfigImpl', () => {
    it('should normalize uppercase log levels to lowercase', () => {
      const testCases = [
        { input: 'DEBUG', expected: 'debug' },
        { input: 'INFO', expected: 'info' },
        { input: 'WARN', expected: 'warn' },
        { input: 'ERROR', expected: 'error' },
        { input: 'SILENT', expected: 'silent' },
      ];

      testCases.forEach(({ input, expected }) => {
        const config = new TraceRootConfigImpl({
          service_name: 'test',
          github_owner: 'test',
          github_repo_name: 'test',
          github_commit_hash: 'test',
          log_level: input as any,
        });

        expect(config.log_level).toBe(expected);
      });
    });

    it('should keep lowercase log levels unchanged', () => {
      const testCases = [
        { input: 'debug', expected: 'debug' },
        { input: 'info', expected: 'info' },
        { input: 'warn', expected: 'warn' },
        { input: 'error', expected: 'error' },
        { input: 'silent', expected: 'silent' },
      ];

      testCases.forEach(({ input, expected }) => {
        const config = new TraceRootConfigImpl({
          service_name: 'test',
          github_owner: 'test',
          github_repo_name: 'test',
          github_commit_hash: 'test',
          log_level: input as any,
        });

        expect(config.log_level).toBe(expected);
      });
    });

    it('should use default log_level when none provided', () => {
      const config = new TraceRootConfigImpl({
        service_name: 'test',
        github_owner: 'test',
        github_repo_name: 'test',
        github_commit_hash: 'test',
      });

      expect(config.log_level).toBe('debug');
    });
  });

  describe('getLogger function', () => {
    beforeEach(() => {
      // Mock global config for getLogger tests
      const { setGlobalConfig } = require('../../src/logger');
      const mockConfig = new TraceRootConfigImpl({
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-hash',
        log_level: 'info',
      });
      setGlobalConfig(mockConfig);
    });

    it('should accept uppercase log levels in getLogger function', () => {
      const testCases = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'SILENT'] as const;

      testCases.forEach(logLevel => {
        expect(() => {
          getLogger('test-logger', logLevel);
        }).not.toThrow();
      });
    });

    it('should normalize uppercase log levels in getLogger function', () => {
      const debugLogger = getLogger('test-logger', 'DEBUG');
      const config = (debugLogger as any).config;

      expect(config.log_level).toBe('debug');
    });

    it('should work with lowercase log levels in getLogger function', () => {
      const testCases = ['debug', 'info', 'warn', 'error', 'silent'] as const;

      testCases.forEach(logLevel => {
        expect(() => {
          getLogger('test-logger', logLevel);
        }).not.toThrow();
      });
    });
  });
});
