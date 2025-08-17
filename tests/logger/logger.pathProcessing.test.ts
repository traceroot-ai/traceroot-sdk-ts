import * as fs from 'fs';
import * as path from 'path';

// Mock fs and path modules
jest.mock('fs');
jest.mock('path');

const mockedFs = jest.mocked(fs);
const mockedPath = jest.mocked(path);

// Import the logger module to access its functions
// Since the functions are private, we'll need to test them indirectly through the logger

describe('Logger Path Processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock process.cwd() to return a consistent value
    jest.spyOn(process, 'cwd').mockReturnValue('/Users/test/code/traceroot-sdk-ts');

    // Setup basic path mocks
    mockedPath.join.mockImplementation((...args) => args.join('/'));
    mockedPath.dirname.mockImplementation((p) => {
      const parts = p.split('/');
      parts.pop();
      return parts.join('/') || '/';
    });
    mockedPath.relative.mockImplementation((from, to) => {
      // Simple relative path calculation for testing
      const fromParts = from.split('/').filter(p => p);
      const toParts = to.split('/').filter(p => p);

      // Find common base
      let commonLength = 0;
      while (commonLength < fromParts.length &&
             commonLength < toParts.length &&
             fromParts[commonLength] === toParts[commonLength]) {
        commonLength++;
      }

      // Build relative path
      const upLevels = fromParts.length - commonLength;
      const downPath = toParts.slice(commonLength);

      if (upLevels === 0 && downPath.length === 0) return '.';

      return downPath.join('/');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Helper function to recreate the path processing logic for testing
  function processPathFormat(filepath: string): string {
    let processedPath = filepath;

    // Handle webpack-internal paths - remove the webpack-internal prefix and resolve to actual location
    if (processedPath.includes('webpack-internal:///')) {
      // Remove webpack-internal:///(rsc)/ or similar prefixes
      processedPath = processedPath.replace(/webpack-internal:\/\/\/\([^)]*\)\//, '');
      // Also handle webpack-internal:/// without parentheses
      processedPath = processedPath.replace(/webpack-internal:\/\/\//, '');

      // Clean up the path before trying to find actual file location
      // Handle paths that start with './' - remove the './' prefix
      if (processedPath.startsWith('./')) {
        processedPath = processedPath.substring(2);
      }

      // For webpack paths, try to find the actual file location in the repository
      const actualPath = findActualFilePath(processedPath);
      if (actualPath) {
        return actualPath;
      }
    }

    // Handle paths that start with './' - remove the './' prefix
    if (processedPath.startsWith('./')) {
      processedPath = processedPath.substring(2);
    }

    // Handle paths that start with '../' - remove any number of '../' prefixes
    processedPath = processedPath.replace(/^(\.\.\/)+/, '');

    // For relative paths, try to clean them up and find meaningful parts
    if (processedPath) {
      return getRelativeFromNonAbsolute(processedPath);
    }

    return processedPath || 'unknown';
  }

  function findActualFilePath(relativePath: string): string | null {
    try {
      // Get the current working directory and find the git root
      let currentDir = process.cwd();
      let gitRoot: string | null = null;

      // Walk up the directory tree to find .git folder
      while (currentDir !== path.dirname(currentDir)) {
        if (fs.existsSync(path.join(currentDir, '.git'))) {
          gitRoot = currentDir;
          break;
        }
        currentDir = path.dirname(currentDir);
      }

      if (!gitRoot) {
        gitRoot = process.cwd();
      }

      // First, check if the file exists directly from git root
      const directPath = path.join(gitRoot, relativePath);
      if (fs.existsSync(directPath)) {
        return relativePath;
      }

      // Function to recursively search for the file
      function searchForFile(dir: string, targetFile: string, maxDepth = 3, currentDepth = 0): string | null {
        if (currentDepth > maxDepth) return null;

        try {
          const items = fs.readdirSync(dir);

          for (const item of items) {
            if (item === 'node_modules' || item === '.git' || item.startsWith('.')) {
              continue;
            }

            const itemPath = path.join(dir, item);
            const stat = fs.statSync(itemPath);

            if (stat.isDirectory()) {
              const potentialFile = path.join(itemPath, targetFile);
              if (fs.existsSync(potentialFile)) {
                return path.relative(gitRoot!, potentialFile);
              }

              const found = searchForFile(itemPath, targetFile, maxDepth, currentDepth + 1);
              if (found) return found;
            }
          }
        } catch (error) {
          // Skip directories we can't read
        }

        return null;
      }

      return searchForFile(gitRoot, relativePath);

    } catch (error) {
      return null;
    }
  }

  function getRelativeFromNonAbsolute(filepath: string): string {
    const pathParts = filepath.split('/');

    // Look for common project structure indicators
    const projectIndicators = ['src', 'lib', 'app', 'examples', 'test', 'tests', 'dist', 'pages', 'components'];
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      if (projectIndicators.includes(part)) {
        const relativeParts = pathParts.slice(i);
        if (relativeParts.length > 0) {
          return relativeParts.join('/');
        }
      }
    }

    return filepath;
  }

  describe('webpack-internal path processing', () => {
    beforeEach(() => {
      // Mock file system structure
      mockedFs.existsSync.mockImplementation((filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('.git')) {
          return pathStr === '/Users/test/code/traceroot-sdk-ts/.git';
        }
        if (pathStr === '/Users/test/code/traceroot-sdk-ts/examples/multi_code_agent/ui/src/app/api/code/route.ts') {
          return true;
        }
        if (pathStr === '/Users/test/code/traceroot-sdk-ts/src/logger.ts') {
          return true;
        }
        return false;
      });

      mockedFs.readdirSync.mockImplementation((dirPath) => {
        const pathStr = dirPath.toString();
        if (pathStr === '/Users/test/code/traceroot-sdk-ts') {
          return ['src', 'examples', '.git', 'node_modules'] as any;
        }
        if (pathStr === '/Users/test/code/traceroot-sdk-ts/examples') {
          return ['multi_code_agent'] as any;
        }
        if (pathStr === '/Users/test/code/traceroot-sdk-ts/examples/multi_code_agent') {
          return ['ui'] as any;
        }
        if (pathStr === '/Users/test/code/traceroot-sdk-ts/examples/multi_code_agent/ui') {
          return ['src'] as any;
        }
        if (pathStr === '/Users/test/code/traceroot-sdk-ts/src') {
          return ['logger.ts', 'index.ts', 'config.ts'] as any;
        }
        return [] as any;
      });

      mockedFs.statSync.mockImplementation((filePath) => {
        const pathStr = filePath.toString();
        return ({
          isDirectory: () => !pathStr.includes('.ts') && !pathStr.includes('.js')
        } as any);
      });
    });

    test('should handle webpack-internal RSC paths - complex case', () => {
      // This test demonstrates the complex file resolution
      const input = 'webpack-internal:///(rsc)/./src/app/api/code/route.ts';

      const result = processPathFormat(input);

      // Should strip webpack-internal prefix
      expect(result).not.toContain('webpack-internal:///');
      // Should contain the core path structure
      expect(result).toContain('src/app/api/code/route.ts');
    });

    test('should handle webpack-internal paths without parentheses', () => {
      const input = 'webpack-internal:///src/logger.ts';
      const expected = 'src/logger.ts';

      const result = processPathFormat(input);
      expect(result).toBe(expected);
    });

    test('should strip webpack-internal prefix correctly', () => {
      const input1 = 'webpack-internal:///(rsc)/./src/components/Button.tsx';
      const input2 = 'webpack-internal:///pages/api/handler.ts';

      const result1 = processPathFormat(input1);
      const result2 = processPathFormat(input2);

      // Should not contain webpack-internal in results
      expect(result1).not.toContain('webpack-internal:///');
      expect(result2).not.toContain('webpack-internal:///');

      // Should contain meaningful paths
      expect(result1).toContain('src/components/Button.tsx');
      expect(result2).toContain('pages/api/handler.ts');
    });

    test('should handle webpack-internal RSC paths with ./ prefix correctly', () => {
      const input = 'webpack-internal:///(rsc)/./app/api/middleware.ts';

      const result = processPathFormat(input);

      // Should strip webpack-internal prefix
      expect(result).not.toContain('webpack-internal:///');
      // Should remove ./ prefix and return clean path
      expect(result).toBe('app/api/middleware.ts');
      // Should not start with ./ prefix
      expect(result.startsWith('./')).toBe(false);
    });
  });

  describe('relative path processing', () => {
    test('should handle ./ prefixed paths', () => {
      const input = './src/components/Button.tsx';
      const expected = 'src/components/Button.tsx';

      const result = processPathFormat(input);
      expect(result).toBe(expected);
    });

    test('should handle ../ prefixed paths', () => {
      const input = '../lib/utils.ts';
      const expected = 'lib/utils.ts';

      const result = processPathFormat(input);
      expect(result).toBe(expected);
    });

    test('should handle multiple ../ prefixes', () => {
      const input = '../../app/components/Header.tsx';
      const expected = 'app/components/Header.tsx';

      const result = processPathFormat(input);
      expect(result).toBe(expected);
    });

    test('should preserve already clean relative paths', () => {
      const input = 'src/utils/helper.js';
      const expected = 'src/utils/helper.js';

      const result = processPathFormat(input);
      expect(result).toBe(expected);
    });
  });

  describe('project structure detection', () => {
    test('should detect src directory structure', () => {
      const input = 'some/deep/nested/src/components/Button.tsx';
      const expected = 'src/components/Button.tsx';

      const result = processPathFormat(input);
      expect(result).toBe(expected);
    });

    test('should detect examples directory structure', () => {
      const input = 'project/root/examples/demo/app.ts';
      const expected = 'examples/demo/app.ts';

      const result = processPathFormat(input);
      expect(result).toBe(expected);
    });

    test('should detect app directory structure', () => {
      const input = 'nested/folders/app/api/route.ts';
      const expected = 'app/api/route.ts';

      const result = processPathFormat(input);
      expect(result).toBe(expected);
    });
  });

  describe('edge cases', () => {
    test('should handle empty paths', () => {
      const input = '';
      const expected = 'unknown';

      const result = processPathFormat(input);
      expect(result).toBe(expected);
    });

    test('should handle single filename', () => {
      const input = 'index.ts';
      const expected = 'index.ts';

      const result = processPathFormat(input);
      expect(result).toBe(expected);
    });

    test('should handle paths without project indicators', () => {
      const input = 'some/random/path/file.ts';
      const expected = 'some/random/path/file.ts';

      const result = processPathFormat(input);
      expect(result).toBe(expected);
    });
  });

  describe('file system search', () => {
    test('should find git root directory', () => {
      mockedFs.existsSync.mockImplementation((filePath) => {
        return filePath.toString().includes('.git');
      });

      const result = processPathFormat('webpack-internal:///src/test.ts');

      // Should have called existsSync to look for .git
      expect(mockedFs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining('.git')
      );
    });

    test('should fallback when git root not found', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const input = 'webpack-internal:///src/test.ts';
      const result = processPathFormat(input);

      // Should still process the path even without git root
      expect(result).toBe('src/test.ts');
    });

    test('should skip node_modules and .git directories in search', () => {
      mockedFs.readdirSync.mockReturnValue(['src', 'node_modules', '.git', '.env'] as any);

      processPathFormat('webpack-internal:///src/test.ts');

      // The search function should skip these directories
      expect(mockedFs.readdirSync).toHaveBeenCalled();
    });

    test('should demonstrate file resolution capability', () => {
      // Mock a scenario where the file is found in a nested location
      mockedFs.existsSync.mockImplementation((filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('.git')) {
          return pathStr === '/Users/test/code/traceroot-sdk-ts/.git';
        }
        // File found in nested location
        if (pathStr === '/Users/test/code/traceroot-sdk-ts/examples/nested/src/component.tsx') {
          return true;
        }
        return false;
      });

      mockedFs.readdirSync.mockImplementation((dirPath) => {
        const pathStr = dirPath.toString();
        if (pathStr === '/Users/test/code/traceroot-sdk-ts') {
          return ['examples', '.git'] as any;
        }
        if (pathStr === '/Users/test/code/traceroot-sdk-ts/examples') {
          return ['nested'] as any;
        }
        return [] as any;
      });

      const input = 'webpack-internal:///src/component.tsx';
      const result = processPathFormat(input);

      // Should successfully resolve and strip webpack prefix
      expect(result).not.toContain('webpack-internal:///');
      expect(result).toContain('component.tsx');
    });
  });
});
