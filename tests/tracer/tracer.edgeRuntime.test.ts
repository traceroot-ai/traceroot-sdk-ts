/**
 * Edge Runtime compatibility tests for tracer.ts
 */

describe('Tracer Edge Runtime Compatibility', () => {
  // Store original process reference
  const originalProcess = global.process;

  afterEach(() => {
    // Restore original process
    global.process = originalProcess;

    // Reset any tracer state
    const tracer = require('../../src/tracer');
    if (tracer.shutdown) {
      try {
        tracer.shutdown();
      } catch (e) {
        // Ignore shutdown errors in tests
      }
    }
  });

  it('should handle missing process.once in Edge Runtime', () => {
    // Mock Edge Runtime environment where process.once is not available
    const mockProcess = {
      ...originalProcess,
      once: undefined,
      env: { ...originalProcess.env },
    };
    global.process = mockProcess as any;

    // Import fresh tracer instance
    delete require.cache[require.resolve('../../src/tracer')];
    const tracer = require('../../src/tracer');

    // This should not throw an error
    expect(() => {
      tracer._initializeTracing({
        service: {
          name: 'test-edge-service',
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
    // Mock environment where process is mostly missing but has minimal properties
    global.process = {
      env: {},
      cwd: () => '/tmp',
    } as any;

    // Import fresh tracer instance
    delete require.cache[require.resolve('../../src/tracer')];
    const tracer = require('../../src/tracer');

    // This should not throw an error
    expect(() => {
      tracer._initializeTracing({
        service: {
          name: 'test-edge-service',
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

  it('should work normally when process.once is available', () => {
    // Ensure process.once is available (normal Node.js environment)
    expect(typeof process.once).toBe('function');

    // Import fresh tracer instance
    delete require.cache[require.resolve('../../src/tracer')];
    const tracer = require('../../src/tracer');

    expect(() => {
      tracer._initializeTracing({
        service: {
          name: 'test-node-service',
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
