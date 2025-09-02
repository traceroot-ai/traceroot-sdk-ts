import { TraceRootConfig, TraceRootConfigFile } from '../config';
import {
  findTypescriptConfig,
  loadTypescriptConfig,
  loadTypescriptConfigSync,
} from './configLoader';

/**
 * Find and load configuration from TypeScript config file.
 *
 * @returns Configuration object or null if no config found
 */
export async function findAndLoadConfig(): Promise<{
  config: Partial<TraceRootConfig>;
  configFile?: TraceRootConfigFile;
  source: 'typescript';
} | null> {
  // Try to find a TypeScript config file
  const tsConfigPath = findTypescriptConfig();
  if (tsConfigPath) {
    try {
      const configFile = await loadTypescriptConfig(tsConfigPath);
      if (configFile) {
        // Apply environment-specific overrides if present
        const finalConfigFile = applyEnvironmentConfig(configFile);

        // Extract the base config (excluding TypeScript-specific properties)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { init, autoInit, integrations, environments, ...baseConfig } = finalConfigFile;

        return {
          config: baseConfig,
          configFile: finalConfigFile,
          source: 'typescript',
        };
      }
    } catch (_error) {
      void _error;
      // Failed to load TypeScript config
    }
  }
  return null;
}

/**
 * Find and load configuration from TypeScript config file (synchronous).
 *
 * @returns Configuration object or null if no config found
 */
export function findAndLoadConfigSync(): {
  config: Partial<TraceRootConfig>;
  configFile?: TraceRootConfigFile;
  source: 'typescript';
} | null {
  // Try to find a TypeScript config file
  const tsConfigPath = findTypescriptConfig();
  if (tsConfigPath) {
    try {
      const configFile = loadTypescriptConfigSync(tsConfigPath);
      if (configFile) {
        // Apply environment-specific overrides if present
        const finalConfigFile = applyEnvironmentConfig(configFile);

        // Extract the base config (excluding TypeScript-specific properties)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { init, autoInit, integrations, environments, ...baseConfig } = finalConfigFile;

        return {
          config: baseConfig,
          configFile: finalConfigFile,
          source: 'typescript',
        };
      }
    } catch (_error) {
      void _error;
      // Failed to load TypeScript config
    }
  }
  return null;
}

/**
 * Applies environment-specific configuration overrides
 * Automatically detects environment from NODE_ENV or TRACEROOT_ENV
 */
function applyEnvironmentConfig(config: TraceRootConfigFile): TraceRootConfigFile {
  const environment = process.env.NODE_ENV || process.env.TRACEROOT_ENV;

  if (!config.environments || !environment) {
    return config;
  }

  const envOverrides = config.environments[environment];
  if (!envOverrides) {
    return config;
  }

  // Merge environment-specific overrides
  return {
    ...config,
    ...envOverrides,
    // Preserve the original environments and init function
    environments: config.environments,
    init: config.init,
    autoInit: config.autoInit,
  };
}
