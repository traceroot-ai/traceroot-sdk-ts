'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.findTracerootConfig = findTracerootConfig;
var fs_1 = require('fs');
var path_1 = require('path');
var yaml_1 = require('yaml');
/**
 * Find and load the .traceroot-config.yaml file.
 *
 * Searches the current directory and parent/subdirectories for the configuration file.
 *
 * @returns Dictionary containing the configuration, or null if no file found.
 */
function findTracerootConfig() {
  var configFilename = '.traceroot-config.yaml';
  // Check current working directory
  var currentPath = process.cwd();
  var configPath = (0, path_1.join)(currentPath, configFilename);
  if ((0, fs_1.existsSync)(configPath)) {
    try {
      var configContent = (0, fs_1.readFileSync)(configPath, 'utf8');
      var configData = (0, yaml_1.parse)(configContent);
      return configData || {};
    } catch (error) {
      throw new Error('Error reading config file '.concat(configPath, ': ').concat(error));
    }
  }
  // Check subfolders for config file up to 4 levels
  var subFolders = listSubFolders(4, configFilename, currentPath);
  for (var _i = 0, subFolders_1 = subFolders; _i < subFolders_1.length; _i++) {
    var foundPath = subFolders_1[_i];
    try {
      var configContent = (0, fs_1.readFileSync)(foundPath, 'utf8');
      var configData = (0, yaml_1.parse)(configContent);
      return configData || {};
    } catch (error) {
      throw new Error('Error reading config file '.concat(foundPath, ': ').concat(error));
    }
  }
  // Check parent folders for config file up to 4 levels
  var parentFolders = listParentFolders(4, configFilename, currentPath);
  for (var _a = 0, parentFolders_1 = parentFolders; _a < parentFolders_1.length; _a++) {
    var foundPath = parentFolders_1[_a];
    try {
      var configContent = (0, fs_1.readFileSync)(foundPath, 'utf8');
      var configData = (0, yaml_1.parse)(configContent);
      return configData || {};
    } catch (error) {
      throw new Error('Error reading config file '.concat(foundPath, ': ').concat(error));
    }
  }
  return null;
}
/**
 * Search through subdirectories up to the specified level for files matching the name.
 */
function listSubFolders(level, name, startPath) {
  var matches = [];
  function searchLevel(currentPath, currentLevel) {
    if (currentLevel > level) {
      return;
    }
    try {
      var items = (0, fs_1.readdirSync)(currentPath);
      for (var _i = 0, items_1 = items; _i < items_1.length; _i++) {
        var item = items_1[_i];
        var itemPath = (0, path_1.join)(currentPath, item);
        if (item === name) {
          matches.push(itemPath);
        }
        try {
          var stats = (0, fs_1.statSync)(itemPath);
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
function listParentFolders(level, name, startPath) {
  var matches = [];
  var currentPath = startPath;
  for (var i = 0; i <= level; i++) {
    try {
      var items = (0, fs_1.readdirSync)(currentPath);
      for (var _i = 0, items_2 = items; _i < items_2.length; _i++) {
        var item = items_2[_i];
        if (item === name) {
          matches.push((0, path_1.join)(currentPath, item));
        }
      }
    } catch {
      // Skip directories we can't access
    }
    // Move to parent directory
    if (i < level) {
      var parent_1 = (0, path_1.dirname)(currentPath);
      if (parent_1 === currentPath) {
        // Reached filesystem root
        break;
      }
      currentPath = parent_1;
    }
  }
  return matches;
}
