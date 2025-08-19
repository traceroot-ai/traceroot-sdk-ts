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
  console.log('[ConfigLoader] Starting config file search...');

  const configNames = [
    'traceroot.config.ts',
    'traceroot.config.js',
    'traceroot.config.mjs',
    'traceroot.config.cjs',
  ];

  console.log('[ConfigLoader] Looking for config files:', configNames);

  // Strategy 1: Try current working directory
  console.log('[ConfigLoader] Strategy 1: Searching in current working directory');
  try {
    const currentPath = process.cwd();
    console.log('[ConfigLoader] Current working directory:', currentPath);

    if (currentPath && !currentPath.includes('ROOT/') && existsSync(currentPath)) {
      console.log('[ConfigLoader] Current directory exists and is valid');
      for (const configName of configNames) {
        const configPath = join(currentPath, configName);
        console.log('[ConfigLoader] Checking:', configPath);
        if (existsSync(configPath)) {
          console.log('[ConfigLoader] ✓ Found config file using Strategy 1:', configPath);
          return configPath;
        }
      }
      console.log('[ConfigLoader] Strategy 1: No config files found in current directory');
    } else {
      console.log('[ConfigLoader] Strategy 1: Current directory is invalid or contains ROOT/');
    }
  } catch (error) {
    console.error('[ConfigLoader] Strategy 1 failed - process.cwd() error:', error);
    // process.cwd() might fail in some environments
    void error;
  }

  // Strategy 2: Try relative to the module's location
  console.log('[ConfigLoader] Strategy 2: Searching relative to module location');
  try {
    const moduleDir = __dirname;
    console.log('[ConfigLoader] Module directory:', moduleDir);
    let searchDir = moduleDir;

    // Walk up the directory tree to find the project root
    for (let i = 0; i < 10; i++) {
      // Limit to prevent infinite loops
      console.log(
        '[ConfigLoader] Strategy 2 - Searching in directory (level',
        i + 1,
        '):',
        searchDir
      );

      for (const configName of configNames) {
        const configPath = join(searchDir, configName);
        console.log('[ConfigLoader] Checking:', configPath);
        if (existsSync(configPath)) {
          console.log('[ConfigLoader] ✓ Found config file using Strategy 2:', configPath);
          return configPath;
        }
      }

      const parentDir = join(searchDir, '..');
      if (parentDir === searchDir) {
        console.log('[ConfigLoader] Strategy 2: Reached filesystem root, stopping search');
        break; // Reached filesystem root
      }
      searchDir = parentDir;
    }
    console.log('[ConfigLoader] Strategy 2: No config files found after walking up directory tree');
  } catch (error) {
    console.error('[ConfigLoader] Strategy 2 failed:', error);
    void error;
  }

  // Strategy 3: Try common project locations relative to node_modules
  console.log('[ConfigLoader] Strategy 3: Searching relative to node_modules');
  try {
    const moduleLocation = require.resolve('traceroot-sdk-ts/package.json');
    console.log('[ConfigLoader] Module location:', moduleLocation);
    const nodeModulesIndex = moduleLocation.indexOf('node_modules');
    console.log('[ConfigLoader] node_modules index:', nodeModulesIndex);

    if (nodeModulesIndex !== -1) {
      const projectRoot = moduleLocation.substring(0, nodeModulesIndex);
      console.log('[ConfigLoader] Inferred project root:', projectRoot);

      if (existsSync(projectRoot)) {
        console.log('[ConfigLoader] Project root exists, searching for config files');
        for (const configName of configNames) {
          const configPath = join(projectRoot, configName);
          console.log('[ConfigLoader] Checking:', configPath);
          if (existsSync(configPath)) {
            console.log('[ConfigLoader] ✓ Found config file using Strategy 3:', configPath);
            return configPath;
          }
        }
        console.log('[ConfigLoader] Strategy 3: No config files found in project root');
      } else {
        console.log('[ConfigLoader] Strategy 3: Project root does not exist');
      }
    } else {
      console.log('[ConfigLoader] Strategy 3: node_modules not found in module location');
    }
  } catch (error) {
    console.error('[ConfigLoader] Strategy 3 failed - package.json resolution error:', error);
    // This might fail if package.json can't be resolved
    void error;
  }

  // Strategy 4: Try environment variables if available
  console.log('[ConfigLoader] Strategy 4: Checking environment variables');
  try {
    const envConfigPath = process.env.TRACEROOT_CONFIG_PATH;
    console.log('[ConfigLoader] TRACEROOT_CONFIG_PATH environment variable:', envConfigPath);

    if (envConfigPath && existsSync(envConfigPath)) {
      console.log(
        '[ConfigLoader] ✓ Found config file using Strategy 4 (environment variable):',
        envConfigPath
      );
      return envConfigPath;
    } else if (envConfigPath) {
      console.log(
        '[ConfigLoader] Strategy 4: Environment variable set but file does not exist:',
        envConfigPath
      );
    } else {
      console.log('[ConfigLoader] Strategy 4: No TRACEROOT_CONFIG_PATH environment variable set');
    }
  } catch (error) {
    console.error('[ConfigLoader] Strategy 4 failed:', error);
    void error;
  }

  console.log('[ConfigLoader] ✗ No config file found using any strategy');
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
