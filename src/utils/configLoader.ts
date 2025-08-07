import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { TraceRootConfigFile } from '../config';

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
      // Use require for TypeScript files when ts-node is available
      delete require.cache[require.resolve(configPath)]; // Clear cache
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
 * Finds a TypeScript configuration file in the project
 * which is placed in the project root
 */
export function findTypescriptConfig(): string | null {
  const configNames = [
    'traceroot.config.ts',
    'traceroot.config.js',
    'traceroot.config.mjs',
    'traceroot.config.cjs',
  ];

  const currentPath = process.cwd();

  // Check current directory only
  for (const configName of configNames) {
    const configPath = join(currentPath, configName);
    if (existsSync(configPath)) {
      return configPath;
    }
  }

  return null;
}

/**
 * Loads and executes a TypeScript configuration file (synchronous)
 */
export function loadTypescriptConfigSync(configPath: string): TraceRootConfigFile | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    // For synchronous loading, use require only
    delete require.cache[require.resolve(configPath)]; // Clear cache
    const configModule = require(configPath);

    // Support both default export and named export patterns
    const config = configModule.default || configModule.config || configModule;

    // If it's a function, execute it to get the config (synchronous only)
    if (typeof config === 'function') {
      return config();
    }

    return config as TraceRootConfigFile;
  } catch (error) {
    throw new Error(`Error loading TypeScript config file ${configPath}: ${error}`);
  }
}
