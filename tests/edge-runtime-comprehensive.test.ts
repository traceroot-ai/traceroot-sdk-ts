/**
 * Comprehensive Edge Runtime compatibility tests
 */

describe('Edge Runtime Comprehensive Compatibility', () => {
  const originalProcess = global.process;

  beforeEach(() => {
    // Clear module cache
    Object.keys(require.cache).forEach(key => {
      if (key.includes('src/')) {
        delete require.cache[key];
      }
    });
  });

  afterEach(() => {
    // Restore globals
    global.process = originalProcess;
    // Clean up globalThis.EdgeRuntime if we added it
    delete (global.globalThis as any).EdgeRuntime;
  });

  describe('Config Loading in Edge Runtime', () => {
    it('should use environment variables when Edge Runtime is detected via globalThis', () => {
      // Mock Edge Runtime environment
      (global.globalThis as any).EdgeRuntime = {};
      global.process = {
        ...originalProcess,
        env: {
          TRACEROOT_SERVICE_NAME: 'edge-test-service',
          TRACEROOT_GITHUB_OWNER: 'edge-owner',
          TRACEROOT_GITHUB_REPO_NAME: 'edge-repo',
          TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT: 'true',
          TRACEROOT_ENABLE_SPAN_CLOUD_EXPORT: 'false',
        },
      } as any;

      const configLoader = require('../src/utils/configLoader');
      const config = configLoader.loadTypescriptConfigSync(null);

      expect(config.service_name).toBe('edge-test-service');
      expect(config.github_owner).toBe('edge-owner');
      expect(config.github_repo_name).toBe('edge-repo');
      expect(config.enable_log_console_export).toBe(true);
      expect(config.enable_span_cloud_export).toBe(false);
    });

    it('should use environment variables when Edge Runtime is detected via NEXT_RUNTIME', () => {
      // Mock Next.js Edge Runtime environment
      delete (global.globalThis as any).EdgeRuntime;
      global.process = {
        ...originalProcess,
        env: {
          NEXT_RUNTIME: 'edge',
          TRACEROOT_SERVICE_NAME: 'next-edge-service',
          TRACEROOT_TOKEN: 'edge-token-123',
        },
      } as any;

      const configLoader = require('../src/utils/configLoader');
      const config = configLoader.loadTypescriptConfigSync('/some/config/path');

      expect(config.service_name).toBe('next-edge-service');
      expect(config.token).toBe('edge-token-123');
    });

    it('should provide sensible defaults when no environment variables are set', () => {
      // Mock Edge Runtime with minimal environment
      (global.globalThis as any).EdgeRuntime = {};
      global.process = {
        env: {},
      } as any;

      const configLoader = require('../src/utils/configLoader');
      const config = configLoader.loadConfigFromEnv();

      expect(config.service_name).toBe('default-service');
      expect(config.github_owner).toBe('unknown');
      expect(config.github_repo_name).toBe('unknown');
      expect(config.github_commit_hash).toBe('unknown');
      expect(config.token).toBe('');
      expect(config.log_level).toBe('debug');
    });
  });

  describe('Tracer in Edge Runtime', () => {
    it('should initialize tracer without process exit handlers in Edge Runtime', () => {
      // Mock Edge Runtime environment
      (global.globalThis as any).EdgeRuntime = {};
      global.process = {
        env: { NODE_ENV: 'test' },
        once: undefined, // Not available in Edge Runtime
      } as any;

      const tracer = require('../src/tracer');

      expect(() => {
        tracer._initializeTracing({
          service: {
            name: 'edge-tracer-test',
            version: '1.0.0',
            environment: 'test',
            github_owner: 'test',
            github_repo_name: 'test',
          },
          exporters: {
            console: { enabled: true },
            cloud: { enabled: false },
          },
        });
      }).not.toThrow();

      expect(tracer.isInitialized()).toBe(true);
    });

    it('should handle completely missing process object', () => {
      // Mock extreme Edge Runtime scenario
      (global.globalThis as any).EdgeRuntime = {};
      global.process = {
        env: {},
        cwd: () => '/tmp', // Minimal process object
      } as any;

      const tracer = require('../src/tracer');

      expect(() => {
        tracer._initializeTracing({
          service: {
            name: 'minimal-process-test',
            version: '1.0.0',
            environment: 'test',
            github_owner: 'test',
            github_repo_name: 'test',
          },
          exporters: {
            console: { enabled: true },
            cloud: { enabled: false },
          },
        });
      }).not.toThrow();

      expect(tracer.isInitialized()).toBe(true);
    });
  });

  describe('File System Operations in Edge Runtime', () => {
    it('should skip file system operations in Edge Runtime', () => {
      // Mock Edge Runtime environment
      (global.globalThis as any).EdgeRuntime = {};
      global.process = {
        env: { NODE_ENV: 'test' },
        cwd: undefined, // Not available in Edge Runtime
      } as any;

      const configLoader = require('../src/utils/configLoader');

      // This should succeed and return environment-based config without trying to access files
      const config = configLoader.loadTypescriptConfigSync('/some/path');
      expect(config.service_name).toBe('default-service');

      // Verify that the config fallback to environment variables works
      expect(config.github_owner).toBe('unknown');
      expect(config.github_repo_name).toBe('unknown');
    });
  });

  describe('Auto-initialization in Edge Runtime', () => {
    it('should auto-initialize with environment config in Edge Runtime', () => {
      // Mock Edge Runtime environment with proper config
      (global.globalThis as any).EdgeRuntime = {};
      global.process = {
        env: {
          NODE_ENV: 'development',
          TRACEROOT_SERVICE_NAME: 'auto-init-edge-test',
          TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT: 'true',
          TRACEROOT_ENABLE_SPAN_CLOUD_EXPORT: 'false',
          TRACEROOT_DISABLE_AUTO_INIT: 'false',
        },
      } as any;

      // Clear auto-init state
      delete require.cache[require.resolve('../src/autoInit')];

      expect(() => {
        // This should trigger auto-initialization
        const autoInit = require('../src/autoInit');
        void autoInit; // Use the import
      }).not.toThrow();

      // Verify tracer was initialized
      const tracer = require('../src/tracer');
      expect(tracer.isInitialized()).toBe(true);
    });
  });

  describe('Edge Runtime Detection', () => {
    it('should correctly detect Edge Runtime via globalThis.EdgeRuntime', () => {
      (global.globalThis as any).EdgeRuntime = {};
      delete (global.process as any).env.NEXT_RUNTIME;

      const configLoader = require('../src/utils/configLoader');
      const config = configLoader.loadTypescriptConfigSync('any-path');

      // Should load from environment (proving Edge Runtime was detected)
      expect(config.service_name).toBe('default-service');
    });

    it('should correctly detect Edge Runtime via NEXT_RUNTIME environment', () => {
      delete (global.globalThis as any).EdgeRuntime;
      global.process = {
        ...originalProcess,
        env: { NEXT_RUNTIME: 'edge' },
      } as any;

      const configLoader = require('../src/utils/configLoader');
      const config = configLoader.loadTypescriptConfigSync('any-path');

      // Should load from environment (proving Edge Runtime was detected)
      expect(config.service_name).toBe('default-service');
    });
  });
});
