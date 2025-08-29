import { TraceRootConfigImpl } from '../../src/config';
import { getLogger, shutdownLogger, setGlobalConfig } from '../../src/logger';

describe('Logger Module-Based Instances', () => {
  let config: TraceRootConfigImpl;

  beforeEach(() => {
    config = new TraceRootConfigImpl({
      token: 'test-token',
      service_name: 'test-service',
      environment: 'test',
      log_level: 'info',
      local_mode: true,
      enable_log_console_export: false, // Disable for cleaner test output
      enable_log_cloud_export: false,
      enable_span_cloud_export: false,
      github_commit_hash: 'abc123',
      github_owner: 'test',
      github_repo_name: 'test-repo',
      aws_region: 'us-east-1',
    });

    setGlobalConfig(config);
  });

  afterEach(async () => {
    await shutdownLogger();
  });

  it('should return the same logger instance for the same module name', () => {
    // Get logger for ModuleA from different "files"
    const loggerA1 = getLogger('ModuleA');
    const loggerA2 = getLogger('ModuleA');

    // Should be the exact same instance
    expect(loggerA1).toBe(loggerA2);
    expect(loggerA1.loggerName).toBe('ModuleA');
  });

  it('should return different logger instances for different module names', () => {
    const loggerA = getLogger('ModuleA');
    const loggerB = getLogger('ModuleB');

    // Should be different instances
    expect(loggerA).not.toBe(loggerB);
    expect(loggerA.loggerName).toBe('ModuleA');
    expect(loggerB.loggerName).toBe('ModuleB');
  });

  it('should return global logger when no module name is provided', () => {
    const globalLogger = getLogger();
    const moduleLogger = getLogger('ModuleA');

    // Should be different instances
    expect(globalLogger).not.toBe(moduleLogger);
    expect(globalLogger.loggerName).toBe('test-service'); // Falls back to service name
    expect(moduleLogger.loggerName).toBe('ModuleA');
  });

  it('should cache loggers with different log levels separately', () => {
    const loggerInfoA = getLogger('ModuleA', 'info');
    const loggerDebugA = getLogger('ModuleA', 'debug');
    const loggerInfoA2 = getLogger('ModuleA', 'info');

    // Same module with same log level should return same instance
    expect(loggerInfoA).toBe(loggerInfoA2);

    // Same module with different log level should return different instance
    expect(loggerInfoA).not.toBe(loggerDebugA);

    // But both should have the same logger name
    expect(loggerInfoA.loggerName).toBe('ModuleA');
    expect(loggerDebugA.loggerName).toBe('ModuleA');
  });

  it('should handle multiple modules correctly', () => {
    const modules = ['UserService', 'PaymentService', 'OrderService'];
    const loggers = modules.map(module => getLogger(module));

    // Each should be a different instance
    for (let i = 0; i < loggers.length; i++) {
      for (let j = i + 1; j < loggers.length; j++) {
        expect(loggers[i]).not.toBe(loggers[j]);
      }
      expect(loggers[i].loggerName).toBe(modules[i]);
    }

    // Getting the same modules again should return cached instances
    const loggers2 = modules.map(module => getLogger(module));
    for (let i = 0; i < loggers.length; i++) {
      expect(loggers[i]).toBe(loggers2[i]);
    }
  });

  it('should work with child loggers from module-specific loggers', () => {
    const moduleLogger = getLogger('ModuleA');
    const childLogger = moduleLogger.child({ requestId: '123' });

    expect(childLogger).not.toBe(moduleLogger);
    expect(childLogger.loggerName).toBe('ModuleA'); // Child inherits parent's logger name
  });

  it('should share the same config object for efficient credential sharing', () => {
    const loggerA = getLogger('ModuleA');
    const loggerB = getLogger('ModuleB');

    // Get configs
    const configA = (loggerA as any).config;
    const configB = (loggerB as any).config;

    // Configs should be the same object (shared for credential sharing)
    expect(configA).toBe(configB);
  });
});
