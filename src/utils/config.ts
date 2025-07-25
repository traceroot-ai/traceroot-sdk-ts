import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { parse } from 'yaml';
import { TraceRootConfig } from '../config';

/**
 * Find and load the .traceroot-config.yaml file.
 *
 * Searches the current directory and parent/subdirectories for the configuration file.
 *
 * @returns Dictionary containing the configuration, or null if no file found.
 */
export function findTracerootConfig(): Partial<TraceRootConfig> | null {
  const configFilename = '.traceroot-config.yaml';

  // Check current working directory
  const currentPath = process.cwd();
  const configPath = join(currentPath, configFilename);

  if (existsSync(configPath)) {
    try {
      const configContent = readFileSync(configPath, 'utf8');
      const configData = parse(configContent);
      return configData || {};
    } catch (error) {
      throw new Error(`Error reading config file ${configPath}: ${error}`);
    }
  }

  // Check subfolders for config file up to 4 levels
  const subFolders = listSubFolders(4, configFilename, currentPath);
  for (const foundPath of subFolders) {
    try {
      const configContent = readFileSync(foundPath, 'utf8');
      const configData = parse(configContent);
      return configData || {};
    } catch (error) {
      throw new Error(`Error reading config file ${foundPath}: ${error}`);
    }
  }

  // Check parent folders for config file up to 4 levels
  const parentFolders = listParentFolders(4, configFilename, currentPath);
  for (const foundPath of parentFolders) {
    try {
      const configContent = readFileSync(foundPath, 'utf8');
      const configData = parse(configContent);
      return configData || {};
    } catch (error) {
      throw new Error(`Error reading config file ${foundPath}: ${error}`);
    }
  }

  return null;
}

/**
 * Search through subdirectories up to the specified level for files matching the name.
 */
function listSubFolders(level: number, name: string, startPath: string): string[] {
  const matches: string[] = [];

  function searchLevel(currentPath: string, currentLevel: number) {
    if (currentLevel > level) {
      return;
    }

    try {
      const items = readdirSync(currentPath);

      for (const item of items) {
        const itemPath = join(currentPath, item);

        if (item === name) {
          matches.push(itemPath);
        }

        try {
          const stats = statSync(itemPath);
          if (stats.isDirectory() && currentLevel < level) {
            searchLevel(itemPath, currentLevel + 1);
          }
        } catch {
          // Skip items we can't access
          continue;
        }
      }
    } catch {
      // Skip directories we can't access
      return;
    }
  }

  searchLevel(startPath, 0);
  return matches;
}

/**
 * Search through parent directories up to the specified level for files matching the name.
 */
function listParentFolders(level: number, name: string, startPath: string): string[] {
  const matches: string[] = [];
  let currentPath = startPath;

  for (let i = 0; i <= level; i++) {
    try {
      const items = readdirSync(currentPath);

      for (const item of items) {
        if (item === name) {
          matches.push(join(currentPath, item));
        }
      }
    } catch {
      // Skip directories we can't access
    }

    // Move to parent directory
    if (i < level) {
      const parent = dirname(currentPath);
      if (parent === currentPath) {
        // Reached filesystem root
        break;
      }
      currentPath = parent;
    }
  }

  return matches;
}
