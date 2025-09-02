import { join } from 'path';
import { pathToFileURL } from 'url';
import { TraceRootConfigFile } from '../config';

// Edge Runtime detection
function isEdgeRuntime(): boolean {
  return (
    typeof (globalThis as Record<string, unknown>).EdgeRuntime !== 'undefined' ||
    process.env.NEXT_RUNTIME === 'edge'
  );
}

// Load config from environment variables for Edge Runtime
export function loadConfigFromEnv(): TraceRootConfigFile {
  const config: Partial<TraceRootConfigFile> = {
    service_name: process.env.TRACEROOT_SERVICE_NAME || 'default-service',
    github_owner: process.env.TRACEROOT_GITHUB_OWNER || 'unknown',
    github_repo_name: process.env.TRACEROOT_GITHUB_REPO_NAME || 'unknown',
    github_commit_hash: process.env.TRACEROOT_GITHUB_COMMIT_HASH || 'unknown',
    token: process.env.TRACEROOT_TOKEN || '',
    log_level:
      (process.env.TRACEROOT_LOG_LEVEL as
        | 'debug'
        | 'info'
        | 'warn'
        | 'error'
        | 'silent'
        | 'DEBUG'
        | 'INFO'
        | 'WARN'
        | 'ERROR'
        | 'SILENT') || 'debug',
  };

  // Only include optional properties if explicitly set in environment variables
  if (process.env.TRACEROOT_NAME) {
    config.name = process.env.TRACEROOT_NAME;
  }
  if (process.env.TRACEROOT_AWS_REGION) {
    config.aws_region = process.env.TRACEROOT_AWS_REGION;
  }
  if (process.env.TRACEROOT_OTLP_ENDPOINT) {
    config.otlp_endpoint = process.env.TRACEROOT_OTLP_ENDPOINT;
  }
  if (process.env.TRACEROOT_ENVIRONMENT) {
    config.environment = process.env.TRACEROOT_ENVIRONMENT;
  }
  if (process.env.TRACEROOT_ENABLE_SPAN_CONSOLE_EXPORT !== undefined) {
    config.enable_span_console_export = process.env.TRACEROOT_ENABLE_SPAN_CONSOLE_EXPORT === 'true';
  }
  if (process.env.TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT !== undefined) {
    config.enable_log_console_export = process.env.TRACEROOT_ENABLE_LOG_CONSOLE_EXPORT === 'true';
  }
  if (process.env.TRACEROOT_ENABLE_SPAN_CLOUD_EXPORT !== undefined) {
    config.enable_span_cloud_export = process.env.TRACEROOT_ENABLE_SPAN_CLOUD_EXPORT === 'true';
  }
  if (process.env.TRACEROOT_ENABLE_LOG_CLOUD_EXPORT !== undefined) {
    config.enable_log_cloud_export = process.env.TRACEROOT_ENABLE_LOG_CLOUD_EXPORT === 'true';
  }
  if (process.env.TRACEROOT_LOCAL_MODE !== undefined) {
    config.local_mode = process.env.TRACEROOT_LOCAL_MODE === 'true';
  }

  return config;
}

// Edge Runtime compatible fs functions
function existsSync(path: string): boolean {
  if (isEdgeRuntime()) {
    return false;
  }
  try {
    const fs = require('fs');
    return fs.existsSync(path);
  } catch {
    return false;
  }
}

/**
 * Check if TypeScript compiler is available
 */
function isTypeScriptAvailable(): boolean {
  try {
    require.resolve('typescript');
    return true;
  } catch {
    return false;
  }
}

/**
 * Manually compile TypeScript to JavaScript
 */
function compileTypeScriptManually(tsContent: string, configPath: string): string {
  try {
    const ts = require('typescript');

    // Basic TypeScript compiler options for config files
    const compilerOptions = {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2018,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      skipLibCheck: true,
      declaration: false,
      sourceMap: false,
      removeComments: true,
      strict: false, // More lenient for config files
      noImplicitAny: false,
      allowJs: true,
    };

    const result = ts.transpile(tsContent, compilerOptions, configPath);
    return result;
  } catch (error) {
    throw new Error(`TypeScript compilation failed: ${error}`);
  }
}

/**
 * Loads and executes a TypeScript configuration file
 */
export async function loadTypescriptConfig(
  configPath: string
): Promise<TraceRootConfigFile | null> {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    let configModule: Record<string, unknown>;

    // Check if we're running with ts-node or if the file is .js/.mjs
    // TODO: Support other runtimes
    const isTypeScript = configPath.endsWith('.ts');
    const hasTypescriptRuntime =
      process.env.TS_NODE_DEV || process.env.TS_NODE_PROJECT || process.argv[0].includes('ts-node');

    if (isTypeScript && hasTypescriptRuntime) {
      try {
        require('ts-node').register({
          project: configPath,
        });
      } catch (_error) {
        void _error;
      }
      // Use require for TypeScript files when ts-node is available
      delete require.cache[configPath]; // Clear cache
      configModule = require(configPath);
    } else {
      // Use dynamic import for JavaScript files or compiled TypeScript
      const fileUrl = pathToFileURL(configPath).href;
      configModule = await import(fileUrl);
    }

    // Support both default export and named export patterns
    const config = configModule.default || configModule.config || configModule;

    // If it's a function, execute it to get the config
    if (typeof config === 'function') {
      return await config();
    }

    return config as TraceRootConfigFile;
  } catch (error) {
    throw new Error(`Error loading TypeScript config file ${configPath}: ${error}`);
  }
}

/**
 * Finds a configuration file in the project root
 * Tries TypeScript first, then falls back to JavaScript alternatives
 * Uses multiple strategies to handle different environments (including Turbopack)
 * In Edge Runtime, returns null to trigger env var loading
 */
export function findTypescriptConfig(): string | null {
  // In Edge Runtime, skip file-based config loading
  if (isEdgeRuntime()) {
    return null;
  }

  const configNames = [
    'traceroot.config.ts',
    'traceroot.config.js',
    'traceroot.config.mjs',
    'traceroot.config.cjs',
  ];

  // Strategy 1: Try environment variables if available
  try {
    const envConfigPath = process.env.TRACEROOT_CONFIG_PATH;

    if (envConfigPath && envConfigPath.trim() !== '' && existsSync(envConfigPath)) {
      return envConfigPath;
    }
  } catch (error) {
    console.error('[ConfigLoader] Strategy 1 failed:', error);
    void error;
  }

  // Strategy 2: Try current working directory
  try {
    const currentPath = process.cwd();

    if (currentPath && !currentPath.includes('ROOT/') && existsSync(currentPath)) {
      for (const configName of configNames) {
        const configPath = join(currentPath, configName);
        if (existsSync(configPath)) {
          return configPath;
        }
      }
    }
  } catch (error) {
    console.error('[ConfigLoader] Strategy 2 failed - process.cwd() error:', error);
    // process.cwd() might fail in some environments
    void error;
  }

  return null;
}

/**
 * Loads and executes a configuration file (synchronous)
 * Tries TypeScript first, falls back to JavaScript if TypeScript fails
 * In Edge Runtime, loads from environment variables
 * Falls back to environment variables when file loading fails in any environment
 */
export function loadTypescriptConfigSync(configPath: string | null): TraceRootConfigFile | null {
  // In Edge Runtime, load from environment variables immediately
  if (isEdgeRuntime()) {
    return loadConfigFromEnv();
  }

  // If no config path provided or file doesn't exist, try fallback strategies
  if (!configPath || !existsSync(configPath)) {
    return tryJavaScriptFallback(); // This will eventually fallback to env vars
  }

  const isTypeScript = configPath.endsWith('.ts');

  try {
    // For TypeScript files, try to register ts-node
    if (isTypeScript) {
      try {
        require('ts-node').register({
          project: configPath,
        });
      } catch (_error) {
        void _error;
        // Try manual TypeScript compilation if TypeScript compiler is available
        if (isTypeScriptAvailable()) {
          return loadTypeScriptManually(configPath);
        } else {
          return tryJavaScriptFallback();
        }
      }
    }

    // Clear cache using the absolute path
    delete require.cache[configPath];

    let configModule: Record<string, unknown>;
    try {
      // Try direct require first
      configModule = require(configPath);
    } catch (requireError) {
      void requireError;
      try {
        // Fallback: Manual module compilation
        const fs = require('fs');
        const fileContent = fs.readFileSync(configPath, 'utf8');
        const Module = require('module');
        const tempModule = new Module(configPath);
        tempModule.filename = configPath;
        tempModule.paths = Module._nodeModulePaths(require('path').dirname(configPath));
        tempModule._compile(fileContent, configPath);
        configModule = tempModule.exports;
      } catch (compileError) {
        throw compileError;
      }
    }

    // Support both default export and named export patterns
    const config = configModule.default || configModule.config || configModule;

    // If it's a function, execute it to get the config (synchronous only)
    if (typeof config === 'function') {
      return config();
    }

    return config as TraceRootConfigFile;
  } catch (_error) {
    void _error;
    // If this was a TypeScript file and it failed, try manual compilation or fallback
    if (isTypeScript) {
      // Try manual TypeScript compilation if available
      if (isTypeScriptAvailable()) {
        return loadTypeScriptManually(configPath);
      } else {
        return tryJavaScriptFallback();
      }
    }

    // For JavaScript files that failed to load, also try fallback
    return tryJavaScriptFallback();
  }
}

/**
 * Load TypeScript config manually by compiling it first
 */
function loadTypeScriptManually(configPath: string): TraceRootConfigFile | null {
  try {
    const fs = require('fs');
    const path = require('path');

    // Read the TypeScript file
    const tsContent = fs.readFileSync(configPath, 'utf8');

    // Compile TypeScript to JavaScript
    const jsContent = compileTypeScriptManually(tsContent, configPath);

    // Create a temporary module to execute the compiled JavaScript
    const Module = require('module');
    const tempModule = new Module(configPath);
    tempModule.filename = configPath;
    tempModule.paths = Module._nodeModulePaths(path.dirname(configPath));

    // Compile and execute the JavaScript
    tempModule._compile(jsContent, configPath);

    // Extract the config
    const configModule = tempModule.exports;
    const config = configModule.default || configModule.config || configModule;

    if (typeof config === 'function') {
      const result = config();
      return result;
    }

    return config as TraceRootConfigFile;
  } catch (error) {
    void error;
    return tryJavaScriptFallback();
  }
}

/**
 * Helper function to try loading JavaScript config alternatives
 * Falls back to environment variables when all file-based loading fails
 */
export function tryJavaScriptFallback(): TraceRootConfigFile | null {
  // In Edge Runtime, load from environment variables immediately
  if (isEdgeRuntime()) {
    return loadConfigFromEnv();
  }

  // Strategy 1: Try environment variable first
  try {
    const envConfigPath = process.env.TRACEROOT_CONFIG_PATH;
    if (envConfigPath && envConfigPath.trim() !== '' && existsSync(envConfigPath)) {
      const result = loadJavaScriptConfig(envConfigPath);
      if (result) {
        return result;
      }
    }
  } catch (_error) {
    void _error;
    // Failed to load config from TRACEROOT_CONFIG_PATH
  }

  // Strategy 2: Try current working directory
  try {
    const currentPath = process.cwd();
    const jsConfigNames = ['traceroot.config.js', 'traceroot.config.mjs', 'traceroot.config.cjs'];

    for (const configName of jsConfigNames) {
      const configPath = join(currentPath, configName);
      if (existsSync(configPath)) {
        const result = loadJavaScriptConfig(configPath);
        if (result) {
          return result;
        }
      }
    }
  } catch (_error) {
    void _error;
    // Failed to load config from current directory
  }

  // Strategy 3: Universal fallback to environment variables when all file loading fails
  // No config files found, attempting to load from environment variables
  return loadConfigFromEnv();
}

/**
 * Helper function to load a JavaScript config file
 */
function loadJavaScriptConfig(configPath: string): TraceRootConfigFile | null {
  try {
    // Clear cache for both relative and absolute paths
    const absolutePath = require('path').resolve(configPath);
    delete require.cache[configPath];
    delete require.cache[absolutePath];

    let configModule: Record<string, unknown>;

    // Always use manual file reading to avoid Node.js module cache issues in tests
    // This ensures we read the latest content from disk
    try {
      const fs = require('fs');
      const fileContent = fs.readFileSync(absolutePath, 'utf8');
      const Module = require('module');
      const tempModule = new Module(absolutePath);
      tempModule.filename = absolutePath;
      tempModule.paths = Module._nodeModulePaths(require('path').dirname(absolutePath));
      tempModule._compile(fileContent, absolutePath);
      configModule = tempModule.exports;
    } catch (manualError) {
      void manualError;
      // Fallback to standard require if manual loading fails
      try {
        configModule = require(absolutePath);
      } catch (requireError) {
        throw requireError;
      }
    }

    const config = configModule.default || configModule.config || configModule;

    if (typeof config === 'function') {
      return config();
    }

    return config as TraceRootConfigFile;
  } catch (_error) {
    void _error;
    // Failed to load JavaScript config
    return null;
  }
}
