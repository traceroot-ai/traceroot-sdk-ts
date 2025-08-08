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
 */
export function findTypescriptConfig(): string | null {
  const currentPath = process.cwd();

  // Try TypeScript first
  const tsConfigPath = join(currentPath, 'traceroot.config.ts');
  if (existsSync(tsConfigPath)) {
    return tsConfigPath;
  }

  // Fall back to JavaScript alternatives
  const jsConfigNames = ['traceroot.config.js', 'traceroot.config.mjs', 'traceroot.config.cjs'];

  for (const configName of jsConfigNames) {
    const configPath = join(currentPath, configName);
    if (existsSync(configPath)) {
      return configPath;
    }
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
function tryJavaScriptFallback(): TraceRootConfigFile | null {
  const currentPath = process.cwd();
  const jsConfigNames = ['traceroot.config.js', 'traceroot.config.mjs', 'traceroot.config.cjs'];

  for (const configName of jsConfigNames) {
    const configPath = join(currentPath, configName);
    if (existsSync(configPath)) {
      try {
        delete require.cache[configPath];

        let configModule: any;

        // Try multiple loading strategies for better compatibility
        try {
          // Strategy 1: Direct require with absolute path
          configModule = require(configPath);
        } catch (requireError) {
          void requireError;
          try {
            // Strategy 2: Try reading and evaluating the file manually
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

        const config = configModule.default || configModule.config || configModule;

        if (typeof config === 'function') {
          return config();
        }

        return config as TraceRootConfigFile;
      } catch (error) {
        console.warn(`Failed to load JavaScript config ${configPath}: ${error}`);
        continue;
      }
    }
  }
  return null;
}
