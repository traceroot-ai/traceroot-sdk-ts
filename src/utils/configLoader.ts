import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { TraceRootConfigFile } from '../config';

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
    const compilerOptions: any = {
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
    let configModule: any;

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
      } catch (error) {
        void error;
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
 */
export function findTypescriptConfig(): string | null {
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
 */
export function loadTypescriptConfigSync(configPath: string): TraceRootConfigFile | null {
  if (!existsSync(configPath)) {
    return null;
  }

  const isTypeScript = configPath.endsWith('.ts');

  try {
    // For TypeScript files, try to register ts-node
    if (isTypeScript) {
      try {
        require('ts-node').register({
          project: configPath,
        });
      } catch (error) {
        void error;
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

    let configModule: any;
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
  } catch (error) {
    void error;
    // If this was a TypeScript file and it failed, try manual compilation or fallback
    if (isTypeScript) {
      // Try manual TypeScript compilation if available
      if (isTypeScriptAvailable()) {
        return loadTypeScriptManually(configPath);
      } else {
        return tryJavaScriptFallback();
      }
    }

    return null;
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
 */
export function tryJavaScriptFallback(): TraceRootConfigFile | null {
  // Strategy 1: Try environment variable first
  try {
    const envConfigPath = process.env.TRACEROOT_CONFIG_PATH;
    if (envConfigPath && envConfigPath.trim() !== '' && existsSync(envConfigPath)) {
      return loadJavaScriptConfig(envConfigPath);
    }
  } catch (error) {
    console.warn(`Failed to load config from TRACEROOT_CONFIG_PATH: ${error}`);
  }

  // Strategy 2: Try current working directory
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
  return null;
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

    let configModule: any;

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
  } catch (error) {
    console.warn(`Failed to load JavaScript config ${configPath}: ${error}`);
    return null;
  }
}
