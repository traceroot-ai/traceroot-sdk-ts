/**
 * Enhanced logging with automatic trace correlation
 */

// Edge Runtime detection
function isEdgeRuntime(): boolean {
  return (
    typeof (globalThis as any).EdgeRuntime !== 'undefined' ||
    (typeof process !== 'undefined' && process.env && process.env.NEXT_RUNTIME === 'edge')
  );
}

// Lazy loading function for Winston dependencies
function getWinstonClasses() {
  if (isEdgeRuntime()) {
    return { winston: null, WinstonCloudWatch: null };
  }
  try {
    const winston = require('winston');
    const WinstonCloudWatch = require('winston-cloudwatch');
    return { winston, WinstonCloudWatch };
  } catch (error) {
    console.warn('[TraceRoot] Failed to import Winston dependencies:', error);
    return { winston: null, WinstonCloudWatch: null };
  }
}
import { trace as otelTrace } from '@opentelemetry/api';
import { TraceRootConfigImpl } from './config';
import { AwsCredentials } from './types';
import { API_ENDPOINTS } from './constants';

/**
 * Custom Winston format for trace correlation
 */
const traceCorrelationFormat = (config: TraceRootConfigImpl, loggerName: string) => {
  const { winston } = getWinstonClasses();
  if (!winston) {
    // Return a no-op formatter in Edge Runtime
    return (info: any) => info;
  }
  return winston.format((info: any, _opts?: any) => {
    // Stack trace should already be set by the logging method
    // Don't overwrite it if it's already set

    const span = otelTrace.getActiveSpan();

    if (span) {
      const spanContext = span.spanContext();
      if (
        spanContext &&
        spanContext.traceId &&
        spanContext.traceId !== '00000000000000000000000000000000'
      ) {
        // Convert trace ID to AWS X-Ray format (1-{8 hex chars}-{24 hex chars})
        const traceIdHex = spanContext.traceId;
        if (!config.local_mode) {
          // For CloudWatch logging, use AWS X-Ray format
          info.trace_id = `1-${traceIdHex.substring(0, 8)}-${traceIdHex.substring(8)}`;
        } else {
          // For local logging, use OpenTelemetry format for easier debugging
          info.trace_id = traceIdHex;
        }

        // Format span ID as 16-character hex string (matching Python implementation)
        const spanIdInt = parseInt(spanContext.spanId, 16);
        info.span_id = spanIdInt !== 0 ? spanContext.spanId.padStart(16, '0') : 'no-span';

        // Add log as event to current span if available
        // In local mode: only use direct span events (addSpanEventDirectly)
        // In non-local mode: only use Winston formatter for CloudWatch
        if (config.local_mode && span.isRecording()) {
          try {
            // Get caller information
            const callerInfo = getCallerInfo();

            // Create attributes from the log record
            const attributes: any = {
              'log.level': String(info.level),
              'log.logger': String(loggerName),
              'log.message': String(info.message),
            };

            // Add caller information if available
            if (callerInfo) {
              attributes['log.function'] = String(callerInfo.function);
              attributes['log.lineno'] = Number(callerInfo.lineno);
            }

            // Add trace correlation attributes if available
            if (info.trace_id) {
              attributes['log.trace_id'] = String(info.trace_id);
            }
            if (info.span_id) {
              attributes['log.span_id'] = String(info.span_id);
            }
            if (info.stack_trace) {
              attributes['log.stack_trace'] = String(info.stack_trace);
            }

            // Add service metadata if available
            if (info.service_name) {
              attributes['log.service_name'] = String(info.service_name);
            }
            if (info.environment) {
              attributes['log.environment'] = String(info.environment);
            }
            if (info.github_commit_hash) {
              attributes['log.github_commit_hash'] = String(info.github_commit_hash);
            }
            if (info.github_owner) {
              attributes['log.github_owner'] = String(info.github_owner);
            }
            if (info.github_repo_name) {
              attributes['log.github_repo_name'] = String(info.github_repo_name);
            }

            // Add exception information if present
            if (info.stack && info.level === 'error') {
              attributes['log.exception'] = String(info.stack);
            }

            // Add any additional metadata (Winston merges meta directly into info object)
            // Extract custom properties from info object (excluding known Winston and TraceRoot properties)
            const knownProperties = new Set([
              'level',
              'message',
              'timestamp',
              'trace_id',
              'span_id',
              'stack_trace',
              'service_name',
              'github_commit_hash',
              'github_owner',
              'github_repo_name',
              'environment',
              'stack',
              'meta',
            ]);

            // Collect metadata for span attributes
            const metadataForSpanAttributes: Record<string, any> = {};

            Object.keys(info).forEach(key => {
              if (!knownProperties.has(key)) {
                const value = info[key];
                // Ensure metadata values are properly typed
                if (
                  typeof value === 'string' ||
                  typeof value === 'number' ||
                  typeof value === 'boolean'
                ) {
                  attributes[`log.${key}`] = value;
                  metadataForSpanAttributes[key] = value;
                } else if (value !== null && value !== undefined) {
                  // Convert complex types to JSON strings for proper serialization
                  try {
                    const jsonValue = JSON.stringify(value);
                    attributes[`log.${key}`] = jsonValue;
                    metadataForSpanAttributes[key] = jsonValue;
                  } catch {
                    // Fallback to String() if JSON.stringify fails (e.g., circular references)
                    attributes[`log.${key}`] = String(value);
                    metadataForSpanAttributes[key] = String(value);
                  }
                }
              }
            });

            // Add metadata to span as attributes for searchability (in addition to events)
            // These metadata are searchable in the TraceRoot UI
            if (Object.keys(metadataForSpanAttributes).length > 0) {
              const spanAttributes: Record<string, any> = {};
              Object.keys(metadataForSpanAttributes).forEach(key => {
                spanAttributes[`log.metadata.${key}`] = metadataForSpanAttributes[key];
              });
              span.setAttributes(spanAttributes);
            }

            // Add the log as an event to the span (let OpenTelemetry handle timestamp automatically)
            span.addEvent(`log.${info.level}`, attributes);
          } catch {
            // Don't let event logging errors interfere with the application
          }
        }
      } else {
        info.trace_id = 'no-trace';
        info.span_id = 'no-span';
      }
    } else {
      info.trace_id = 'no-trace';
      info.span_id = 'no-span';
    }

    return info;
  });
};

/**
 * Get caller information from stack trace
 */
function getCallerInfo(): { module: string; function: string; lineno: number } | null {
  const stack = new Error().stack;
  if (!stack) return null;

  const stackLines = stack.split('\n');

  for (let i = 3; i < stackLines.length; i++) {
    // Skip Error, getCallerInfo, and format function
    const line = stackLines[i];
    if (!line) continue;

    // Extract meaningful information from stack trace
    const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
    if (match) {
      const [, functionName, filepath, lineNumber] = match;
      const filename = filepath.split('/').pop() || filepath;

      // Skip tracing and logging module frames
      if (
        filename.includes('tracer.') ||
        filename.includes('logger.') ||
        filename.includes('winston') ||
        filename.includes('node_modules')
      ) {
        continue;
      }

      return {
        module: filename.replace(/\.(ts|js)$/, ''), // Remove file extension
        function: functionName || 'anonymous',
        lineno: parseInt(lineNumber, 10),
      };
    }
  }

  return null;
}

/**
 * Process various path formats to get a meaningful relative path
 */
function processPathFormat(filepath: string, config?: TraceRootConfigImpl): string {
  let processedPath = filepath;

  // Handle webpack-internal paths - remove the webpack-internal prefix and resolve to actual location
  // Example: "webpack-internal:///Users/xxx/code/traceroot-sdk-ts/src/logger.ts"
  // Result: "/Users/xxx/code/traceroot-sdk-ts/src/logger.ts"
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

  // Double check this
  // Handle paths that start with './' - remove the './' prefix
  if (processedPath.startsWith('./')) {
    processedPath = processedPath.substring(2);
  }

  // Handle paths that start with '../' - remove any number of '../' prefixes
  processedPath = processedPath.replace(/^(\.\.\/)+/, '');

  // If it's an absolute path (starts with '/'), try to make it relative to repository root
  if (processedPath.startsWith('/')) {
    return getRelativePath(processedPath, config);
  }

  // For relative paths, try to clean them up and find meaningful parts
  if (processedPath) {
    return getRelativeFromNonAbsolute(processedPath, config);
  }

  return processedPath || 'unknown';
}

/**
 * Find the actual file path by searching through the repository
 * This handles webpack-internal paths that need to be resolved to their actual location
 */
function findActualFilePath(relativePath: string): string | null {
  // In Edge Runtime, file system operations are not available
  if (isEdgeRuntime()) {
    return null;
  }

  // Check if process.cwd is available
  if (typeof process === 'undefined' || typeof process.cwd !== 'function') {
    return null;
  }

  try {
    const fs = require('fs');
    const path = require('path');

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
      // If no git root found, use process.cwd() as fallback
      gitRoot = process.cwd();
    }

    // Function to recursively search for the file
    function searchForFile(
      dir: string,
      targetFile: string,
      maxDepth = 3,
      currentDepth = 0
    ): string | null {
      if (currentDepth > maxDepth) return null;

      try {
        const items = fs.readdirSync(dir);

        for (const item of items) {
          // Skip node_modules and .git directories
          if (item === 'node_modules' || item === '.git' || item.startsWith('.')) {
            continue;
          }

          const itemPath = path.join(dir, item);
          const stat = fs.statSync(itemPath);

          if (stat.isDirectory()) {
            // Check if the target file exists in this directory
            const potentialFile = path.join(itemPath, targetFile);
            if (fs.existsSync(potentialFile)) {
              // Return path relative to git root
              return path.relative(gitRoot!, potentialFile);
            }

            // Recursively search subdirectories
            const found = searchForFile(itemPath, targetFile, maxDepth, currentDepth + 1);
            if (found) return found;
          }
        }
      } catch (error) {
        // Skip directories we can't read
        void error;
      }

      return null;
    }

    // First, check if the file exists directly from git root
    const directPath = path.join(gitRoot, relativePath);
    if (fs.existsSync(directPath)) {
      return relativePath;
    }

    // Search for the file starting from git root
    const foundPath = searchForFile(gitRoot, relativePath);
    return foundPath;
  } catch (error) {
    void error;
    // If anything fails, return null to fall back to original processing
    return null;
  }
}

/**
 * Handle relative/non-absolute paths to extract meaningful parts
 */
function getRelativeFromNonAbsolute(filepath: string, config?: TraceRootConfigImpl): string {
  const pathParts = filepath.split('/');

  // First try to find the repo name in the path
  if (config?.github_repo_name) {
    try {
      const repoIndex = pathParts.indexOf(config.github_repo_name);
      if (repoIndex !== -1) {
        // Take everything after the repo name
        const relativeParts = pathParts.slice(repoIndex + 1);
        if (relativeParts.length > 0) {
          return relativeParts.join('/');
        }
      }
    } catch {
      // Repo name not found in path, continue to fallback
    }
  }

  // Look for common project structure indicators
  const projectIndicators = [
    'src',
    'lib',
    'app',
    'examples',
    'test',
    'tests',
    'dist',
    'pages',
    'components',
  ];
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    if (projectIndicators.includes(part)) {
      const relativeParts = pathParts.slice(i);
      if (relativeParts.length > 0) {
        return relativeParts.join('/');
      }
    }
  }

  // If no indicators found, return the original path (it's already relative)
  return filepath;
}

/**
 * Extract path relative to repository root (similar to Python implementation)
 */
function getRelativePath(filepath: string, config?: TraceRootConfigImpl): string {
  const pathParts = filepath.split('/');

  // First try to find the repo name in the path
  if (config?.github_repo_name) {
    try {
      const repoIndex = pathParts.indexOf(config.github_repo_name);
      if (repoIndex !== -1) {
        // Take everything after the repo name
        const relativeParts = pathParts.slice(repoIndex + 1);

        if (relativeParts.length > 0) {
          return relativeParts.join('/');
        }
      }
    } catch {
      // Repo name not found in path, continue to fallback
    }
  }

  // Fallback: look for common project structure indicators
  const projectIndicators = ['src', 'lib', 'app', 'examples', 'test', 'tests', 'dist'];
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    if (projectIndicators.includes(part)) {
      const relativeParts = pathParts.slice(i);
      if (relativeParts.length > 0) {
        return relativeParts.join('/');
      }
    }
  }

  // Final fallback: use last 2-3 parts for context
  if (pathParts.length >= 3) {
    return pathParts.slice(-3).join('/');
  } else if (pathParts.length >= 2) {
    return pathParts.slice(-2).join('/');
  } else {
    return pathParts[pathParts.length - 1] || 'unknown';
  }
}

/**
 * Get a clean stack trace showing the call path
 */
function getStackTrace(config?: TraceRootConfigImpl): string {
  // Create an error and get the stack trace
  // TODO: find a better way to get the stack trace
  // Here is an example of the stack trace:
  // at getStackTrace (/Users/xxx/code/traceroot-sdk-ts/src/logger.ts:429:17)
  // at TraceRootLogger.info (/Users/xxx/code/traceroot-sdk-ts/src/logger.ts:1027:24)
  // at TraceRootExample.runExample (/Users/xxx/code/traceroot-sdk-ts/examples/simple-example.ts:71:21)
  // at async main (/Users/xxx/code/traceroot-sdk-ts/examples/simple-example.ts:122:3)
  const stack = new Error().stack;
  if (!stack) return 'unknown';

  const stackLines = stack.split('\n');
  const relevantFrames: string[] = [];

  for (let i = 3; i < stackLines.length; i++) {
    // Skip Error, getStackTrace, and format function
    const line = stackLines[i];
    if (!line) continue;

    // Skip Node.js internal modules (entries starting with "node:")
    if (line.includes('node:')) {
      continue;
    }

    // Skip OpenTelemetry and internal framework files
    if (
      line.includes('AsyncLocalStorageContextManager') ||
      line.includes('context.ts') ||
      line.includes('Tracer.ts') ||
      line.includes('AsyncLocalStorage') ||
      line.includes('@opentelemetry') ||
      line.includes('lib/') ||
      line.includes('logform') ||
      line.includes('traceroot-sdk-ts/src') ||
      line.includes('node_modules') ||
      line.includes('winston')
    ) {
      continue;
    }

    // Extract meaningful information from stack trace
    // Example: "at TraceRootExample.runExample (/Users/xxx/code/traceroot-sdk-ts/examples/simple-example.ts:71:21)"
    // Captures: [
    //  full match,
    //  "TraceRootExample.runExample",
    //  "/Users/xxx/code/traceroot-sdk-ts/examples/simple-example.ts",
    //  "71",
    //  "21"
    // ]
    const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
    if (match) {
      const [, functionName, filepath, lineNumber] = match;

      // Get a meaningful relative path instead of just the filename
      let relativePath = filepath;
      // Process various path formats to get a meaningful relative path
      relativePath = processPathFormat(filepath, config);

      const func = functionName || 'anonymous';
      relevantFrames.push(`${relativePath}:${func}:${lineNumber}`);
    }
  }

  // Reverse the frames because most recent frames are at the top of the stack
  return relevantFrames.length > 0 ? relevantFrames.reverse().join(' -> ') : 'unknown';
}

/**
 * Enhanced logger with trace correlation and AWS integration
 */
export class TraceRootLogger {
  private logger: any;
  private consoleLogger: any | null = null; // Separate logger for console output
  private config: TraceRootConfigImpl;
  public loggerName: string;
  private cloudWatchTransport: any | null = null;

  // Child logger support
  private childContext: Record<string, any> = {};
  private parentLogger?: TraceRootLogger;

  /**
   * Format log message according to Python logging format:
   * %(asctime)s;%(levelname)s;%(service_name)s;%(github_commit_hash)s;%(github_owner)s;%(github_repo_name)s;%(environment)s;%(trace_id)s;%(span_id)s;%(stack_trace)s;%(message)s
   */
  private formatCloudWatchMessage(item: any): string {
    const formatValue = (value: any): string => {
      if (value === null || value === undefined) {
        return '';
      }
      return String(value);
    };

    const formattedMessage = [
      formatValue(item.timestamp),
      formatValue(item.level?.toUpperCase()),
      formatValue(item.service_name),
      formatValue(item.github_commit_hash),
      formatValue(item.github_owner),
      formatValue(item.github_repo_name),
      formatValue(item.environment),
      formatValue(item.trace_id),
      formatValue(item.span_id),
      formatValue(item.stack_trace),
      formatValue(item.message),
    ].join(';');

    return formattedMessage;
  }

  private constructor(config: TraceRootConfigImpl, name?: string) {
    this.config = config;
    this.loggerName = name || config.service_name;

    try {
      // Determine the effective log level based on config and export settings
      let effectiveLevel: string;
      if (!config.enable_log_console_export && !config.enable_log_cloud_export) {
        effectiveLevel = 'silent';
      } else {
        effectiveLevel = config.log_level;
      }

      // Get Winston classes
      const { winston } = getWinstonClasses();

      // In Edge Runtime, use console logging directly
      if (isEdgeRuntime() || !winston) {
        console.log(
          '[TraceRoot] Failed to create console logger: A Node.js API is used (process.nextTick) which is not supported in the Edge Runtime.'
        );
        this.logger = {
          debug: (msg: any, meta?: any) => console.debug(`[DEBUG] ${msg}`, meta || ''),
          info: (msg: any, meta?: any) => console.info(`[INFO] ${msg}`, meta || ''),
          warn: (msg: any, meta?: any) => console.warn(`[WARN] ${msg}`, meta || ''),
          error: (msg: any, meta?: any) => console.error(`[ERROR] ${msg}`, meta || ''),
          add: () => {}, // No-op for transport addition
          transports: [],
        } as any;
      } else {
        this.logger = winston.createLogger({
          level: effectiveLevel,
          format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss,SSS' }),
            traceCorrelationFormat(config, this.loggerName)(),
            winston.format.errors({ stack: true }),
            winston.format.json()
          ),
          defaultMeta: {
            service_name: config.service_name,
            github_commit_hash: config.github_commit_hash,
            github_owner: config.github_owner,
            github_repo_name: config.github_repo_name,
            environment: config.environment,
          },
          transports: [],
          // Explicitly handle all transport events
          handleExceptions: false,
          handleRejections: false,
        });
      }
    } catch (error: any) {
      console.error('[TraceRoot] Failed to create winston logger:', error?.message || error);
      // Create a minimal fallback logger that just uses console
      this.logger = {
        debug: (msg: any, meta?: any) => console.debug(`[DEBUG] ${msg}`, meta || ''),
        info: (msg: any, meta?: any) => console.info(`[INFO] ${msg}`, meta || ''),
        warn: (msg: any, meta?: any) => console.warn(`[WARN] ${msg}`, meta || ''),
        error: (msg: any, meta?: any) => console.error(`[ERROR] ${msg}`, meta || ''),
        add: () => {}, // No-op for transport addition
        transports: [],
      } as any;
    }
  }

  /**
   * Static factory method to create and initialize logger (synchronous)
   */
  static create(config: TraceRootConfigImpl, name?: string): TraceRootLogger {
    const logger = new TraceRootLogger(config, name);
    logger.setupTransports();
    return logger;
  }

  /**
   * Check if AWS credentials are expired and refresh if needed
   * Delegates to global credential management to ensure all loggers share the same credentials
   */
  private async checkAndRefreshCredentials(): Promise<AwsCredentials | null> {
    // All loggers (including child loggers) delegate to global credential management
    // This ensures only one refresh happens at a time across all logger instances
    return await checkAndRefreshGlobalCredentials();
  }

  /**
   * Recreate CloudWatch transport with new credentials
   * Uses robust 3-step process:
   * 1) Add new transport,
   * 2) Flush old transport,
   * 3) Remove old transport
   */
  private recreateCloudWatchTransport(credentials: AwsCredentials): void {
    // Get Winston classes
    const { WinstonCloudWatch } = getWinstonClasses();

    if (!WinstonCloudWatch) {
      return;
    }

    try {
      // Create new AWS configuration with updated credentials
      const awsConfig: any = {
        region: credentials.region || this.config.aws_region,
        credentials: {
          accessKeyId: credentials.aws_access_key_id,
          secretAccessKey: credentials.aws_secret_access_key,
          sessionToken: credentials.aws_session_token,
        },
      };

      const logGroupName = this.config._name || this.config.service_name;
      const logStreamName =
        this.config._sub_name || `${this.config.service_name}-${this.config.environment}`;

      // Create new CloudWatch transport with updated credentials
      const newCloudWatchTransport = new WinstonCloudWatch({
        logGroupName: logGroupName,
        logStreamName: logStreamName,
        awsOptions: awsConfig,
        level: this.config.log_level,
        jsonMessage: true,
        uploadRate: 2000,
        errorHandler: (err: any) => {
          console.error('[ERROR] CloudWatch transport errorHandler:', err);
        },
        messageFormatter: (item: any) => this.formatCloudWatchMessage(item),
      });

      // Add error handling for the new transport
      newCloudWatchTransport.on('error', (error: any) => {
        console.error('[ERROR] CloudWatch error details:', error);
        if (error.code) {
          console.error('[ERROR] CloudWatch error code:', error.code);
        }
        if (error.statusCode) {
          console.error('[ERROR] CloudWatch status code:', error.statusCode);
        }
      });

      // Step 1: Add the new transport to the logger (both transports will be active temporarily)
      try {
        this.logger.add(newCloudWatchTransport);
        console.log('[TraceRoot] Added new CloudWatch transport with refreshed credentials');

        // Step 2 & 3: Handle old transport cleanup if it exists
        if (this.cloudWatchTransport) {
          const oldTransport = this.cloudWatchTransport;

          // Step 2: Flush old transport to ensure all pending logs are sent
          if (typeof oldTransport.kthxbye === 'function') {
            // Use winston-cloudwatch's flush method with callback
            try {
              oldTransport.kthxbye(() => {
                // Step 3: Remove old transport after flush completes
                try {
                  this.logger.remove(oldTransport);
                  console.log(
                    '[TraceRoot] Successfully flushed and removed old CloudWatch transport'
                  );
                } catch (removeError: any) {
                  console.error(
                    '[TraceRoot] Failed to remove old CloudWatch transport:',
                    removeError?.message || removeError
                  );
                }
              });
            } catch (flushError: any) {
              console.error(
                '[TraceRoot] Failed to flush old CloudWatch transport, removing directly:',
                flushError?.message || flushError
              );
              // Fallback: remove without flush if flush fails
              try {
                this.logger.remove(oldTransport);
                console.log('[TraceRoot] Removed old CloudWatch transport (flush failed)');
              } catch (removeError: any) {
                console.error(
                  '[TraceRoot] Failed to remove old CloudWatch transport:',
                  removeError?.message || removeError
                );
              }
            }
          } else {
            // Fallback: if no flush method available, remove directly
            try {
              this.logger.remove(oldTransport);
              console.log(
                '[TraceRoot] Removed old CloudWatch transport (no flush method available)'
              );
            } catch (removeError: any) {
              console.error(
                '[TraceRoot] Failed to remove old CloudWatch transport:',
                removeError?.message || removeError
              );
            }
          }
        }

        // Update the reference to the new transport
        this.cloudWatchTransport = newCloudWatchTransport;
        console.log('[TraceRoot] Successfully recreated CloudWatch transport with new credentials');
      } catch (addError: any) {
        console.error(
          '[TraceRoot] Failed to add CloudWatch transport to logger:',
          addError?.message || addError
        );
      }
    } catch (error: any) {
      console.error('[TraceRoot] Failed to recreate CloudWatch transport:', error.message);
    }
  }

  private setupTransports(): void {
    // Console logger for debugging (works in both local and non-local modes)
    if (this.config.enable_log_console_export) {
      try {
        const { winston } = getWinstonClasses();
        // Skip Winston in Edge Runtime
        if (isEdgeRuntime() || !winston) {
          console.log(
            '[TraceRoot] Failed to add null transport: A Node.js API is used (process.nextTick) which is not supported in the Edge Runtime.'
          );
          this.consoleLogger = null;
        } else {
          // Create a separate logger specifically for console output - simple format with just user data
          this.consoleLogger = winston.createLogger({
            level: this.config.log_level,
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.colorize(),
              winston.format.printf((info: any) => {
                // Simple console format - timestamp, level, optional logger name, message, and user metadata
                const loggerName = info.logger_name || this.loggerName;
                const shouldIncludeLoggerName =
                  loggerName && loggerName !== this.config.service_name;

                const userMeta = Object.keys(info)
                  .filter(key => !['level', 'message', 'timestamp', 'logger_name'].includes(key))
                  .reduce((obj, key) => {
                    obj[key] = info[key];
                    return obj;
                  }, {} as any);

                const metaStr =
                  Object.keys(userMeta).length > 0 ? ` ${JSON.stringify(userMeta)}` : '';
                const loggerNameStr = shouldIncludeLoggerName ? ` [${loggerName}]` : '';
                // Extract level without ANSI color codes for uppercase conversion
                const rawLevel = info.level.replace(/\x1b\[[0-9;]*m/g, '');
                const levelStr = rawLevel.toUpperCase();
                // Reapply colors if they existed
                const colorizedLevel = info.level.includes('\x1b[')
                  ? info.level.replace(rawLevel, levelStr)
                  : levelStr;
                return `${info.timestamp} [${colorizedLevel}]${loggerNameStr} ${info.message}${metaStr}`;
              })
            ),
            transports: [
              new winston.transports.Console({
                handleExceptions: false,
                handleRejections: false,
              }),
            ],
          });
        }
      } catch (error: any) {
        console.error('[TraceRoot] Failed to create console logger:', error?.message || error);
        this.consoleLogger = null;
      }
    }

    // Setup appropriate transport based on mode and cloud export setting
    if (!this.config.local_mode && this.config.enable_log_cloud_export) {
      this.setupCloudWatchTransport();
    } else {
      this.setupLocalTransport();
    }
  }

  private setupCloudWatchTransport(): void {
    // Get Winston classes
    const { WinstonCloudWatch } = getWinstonClasses();

    // Skip CloudWatch setup in Edge Runtime
    if (isEdgeRuntime() || !WinstonCloudWatch) {
      return;
    }

    try {
      // Check if credentials were already fetched during tracer initialization
      let credentials: AwsCredentials | null = (this.config as any)._awsCredentials || null;

      // For synchronous initialization, use stored credentials only
      // If no credentials available, skip CloudWatch setup
      if (!credentials) {
        return;
      }

      // Create AWS SDK v3 client configuration
      const awsConfig: any = {
        region: credentials?.region || this.config.aws_region,
      };

      if (credentials) {
        awsConfig.credentials = {
          accessKeyId: credentials.aws_access_key_id,
          secretAccessKey: credentials.aws_secret_access_key,
          sessionToken: credentials.aws_session_token,
        };
      }

      const logGroupName = this.config._name || this.config.service_name;
      const logStreamName =
        this.config._sub_name || `${this.config.service_name}-${this.config.environment}`;

      // Create CloudWatch transport using winston-cloudwatch
      this.cloudWatchTransport = new WinstonCloudWatch({
        logGroupName: logGroupName,
        logStreamName: logStreamName,
        awsOptions: awsConfig,
        level: this.config.log_level,
        jsonMessage: true, // Enable JSON formatting to use our custom formatter
        uploadRate: 1000, // Upload every 1 second
        messageFormatter: (item: any) => this.formatCloudWatchMessage(item),
      });
      try {
        this.logger.add(this.cloudWatchTransport);
      } catch (addError: any) {
        console.error(
          '[TraceRoot] Failed to add initial CloudWatch transport to logger:',
          addError?.message || addError
        );
        this.cloudWatchTransport = null;
      }
    } catch (error: any) {
      void error;
    }
  }

  private setupLocalTransport(): void {
    // For local mode or when cloud export is disabled, logs are handled by:
    // 1. Console output (if enable_log_console_export is true, handled in setupTransports)
    // 2. Direct span events (handled in addSpanEventDirectly)

    // Get Winston classes
    const { winston } = getWinstonClasses();

    // Skip Winston operations in Edge Runtime
    if (isEdgeRuntime() || !winston) {
      console.log(
        '[TraceRoot] Failed to add null transport: A Node.js API is used (process.nextTick) which is not supported in the Edge Runtime.'
      );
      return;
    }

    // Always add a minimal null transport to prevent Winston warnings
    // Create a simple transport that does nothing but prevents "no transports" error
    try {
      const nullTransport = new winston.transports.Console({
        level: 'silent', // Set to silent to minimize processing
        silent: true, // Make it completely silent
      });
      this.logger.add(nullTransport);
    } catch (error: any) {
      console.error('[TraceRoot] Failed to add null transport:', error?.message || error);
    }
  }

  /**
   * Check if a log level should be processed based on the current configuration
   * Log level hierarchy: debug: 0, info: 1, warn: 2, error: 3, silent: 4
   */
  private shouldProcessLogLevel(logLevel: string): boolean {
    const logLevels: Record<string, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      critical: 3, // Critical maps to error level
      silent: 4,
    };

    // Determine the effective log level based on config and export settings
    let effectiveLevel: string;
    if (!this.config.enable_log_console_export && !this.config.enable_log_cloud_export) {
      effectiveLevel = 'silent';
    } else {
      effectiveLevel = this.config.log_level;
    }

    const currentLevelValue = logLevels[effectiveLevel] ?? 0;
    const requestedLevelValue = logLevels[logLevel] ?? 0;

    // Should process if the requested level is >= current level (and not silent)
    return requestedLevelValue >= currentLevelValue;
  }

  private incrementSpanLogCount(attributeName: string, logLevel: string): void {
    // Only increment if this log level should be processed
    if (!this.shouldProcessLogLevel(logLevel)) {
      return;
    }

    // Only increment if span cloud export is enabled (span attributes need cloud export)
    if (!this.config.enable_span_cloud_export) {
      return;
    }

    try {
      const span = otelTrace.getActiveSpan();
      if (span && span.isRecording()) {
        // Get current count (note: OpenTelemetry doesn't have built-in increment)
        // We'll just set the attribute each time
        span.setAttribute(attributeName, 1);
      }
    } catch {
      // Don't let span attribute errors interfere with logging
    }
  }

  /**
   * Helper method to log to console if console export is enabled
   * Only logs user-provided data from the original log arguments
   */
  private logToConsole(level: string, message: string, userMetadata: any): void {
    if (this.consoleLogger) {
      try {
        // Pass only the user-provided metadata (from processLogArgs)
        (this.consoleLogger as any)[level](message, userMetadata || {});
      } catch (error: any) {
        console.error(`[TraceRoot] Console logger ${level} error:`, error?.message || error);
      }
    }
  }

  /**
   * Process log arguments to support Pino-style structured logging
   * Supported patterns:
   * - logger.info('message') - simple string message
   * - logger.info('message', { obj }) - string first, then objects merged
   * - logger.info({ metadata }, 'message') - object first, then message
   * - logger.info({ obj1 }, { obj2 }, 'message') - multiple objects merged, then message
   * - logger.info({ metadata }) - object only, uses default message
   * - logger.info({ obj1 }, { obj2 }) - multiple objects merged, uses default message
   *
   * Note: Duplicate properties are preserved with indexed keys (e.g., property_0, property_1)
   * Child context is merged first, then runtime arguments
   */
  private processLogArgs(
    messageOrObj: string | any,
    ...args: any[]
  ): { message: string; metadata: any } {
    let message: string;
    let runtimeMetadata: any = {};
    const objects: any[] = [];
    let foundMessage: string | null = null;

    // Collect the first argument
    if (typeof messageOrObj === 'string') {
      foundMessage = messageOrObj;
    } else if (
      typeof messageOrObj === 'object' &&
      messageOrObj !== null &&
      !Array.isArray(messageOrObj)
    ) {
      objects.push(messageOrObj);
    } else {
      // Fallback for other types (arrays, primitives, etc.)
      foundMessage = String(messageOrObj);
    }

    // Process remaining arguments
    for (const arg of args) {
      if (typeof arg === 'string' && foundMessage === null) {
        // First string we encounter becomes the message
        foundMessage = arg;
      } else if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
        // Collect objects for merging
        objects.push(arg);
      }
    }

    // Merge all collected objects without overriding duplicate properties
    if (objects.length > 0) {
      runtimeMetadata = this.mergeObjectsPreservingDuplicates(objects);
    }

    // Set the message
    message = foundMessage || 'Log entry';

    // Merge child context with runtime metadata
    // Child context should not be overridable by runtime metadata (pino behavior)
    const finalMetadata = { ...runtimeMetadata, ...this.childContext };

    return { message, metadata: finalMetadata };
  }

  /**
   * Merge objects while preserving duplicate properties by adding indexed suffixes
   * Example: [{a: 'property'}, {a: 'prop'}] becomes {a_0: 'property', a_1: 'prop'}
   */
  private mergeObjectsPreservingDuplicates(objects: any[]): any {
    const result: any = {};
    const keyCounters: Record<string, number> = {};

    for (const obj of objects) {
      for (const [key, value] of Object.entries(obj)) {
        if (result.hasOwnProperty(key) || keyCounters.hasOwnProperty(key)) {
          // Key already exists, add indexed suffix
          const counter = keyCounters[key] || 0;
          keyCounters[key] = counter + 1;

          // If this is the first duplicate, also rename the original
          if (counter === 0) {
            const originalValue = result[key];
            delete result[key];
            result[`${key}_0`] = originalValue;
          }

          result[`${key}_${counter + 1}`] = value;
        } else {
          result[key] = value;
        }
      }
    }

    return result;
  }

  private addSpanEventDirectly(level: string, message: string, meta?: any): void {
    // In local mode, store log events to be added before span ends
    if (!this.config.local_mode) {
      return;
    }

    try {
      const span = otelTrace.getActiveSpan();
      if (!span) return;

      const spanContext = span.spanContext();
      if (
        !spanContext ||
        !spanContext.traceId ||
        spanContext.traceId === '00000000000000000000000000000000'
      )
        return;

      // Create attributes from the log record (same as Winston formatter would do)
      const traceIdHex = spanContext.traceId;
      const formattedTraceId = !this.config.local_mode
        ? `1-${traceIdHex.substring(0, 8)}-${traceIdHex.substring(8)}`
        : traceIdHex;

      // Format span ID as 16-character hex string (matching Python implementation)
      const spanIdInt = parseInt(spanContext.spanId, 16);
      const formattedSpanId = spanIdInt !== 0 ? spanContext.spanId.padStart(16, '0') : 'no-span';

      const attributes: any = {
        'log.level': String(level),
        'log.logger': String(this.loggerName),
        'log.message': String(message),
        'log.trace_id': formattedTraceId,
        'log.span_id': formattedSpanId,
        'log.service_name': this.config.service_name,
        'log.environment': this.config.environment,
        'log.github_commit_hash': this.config.github_commit_hash,
        'log.github_owner': this.config.github_owner,
        'log.github_repo_name': this.config.github_repo_name,
      };

      // Add stack trace if provided in meta, otherwise get it
      attributes['log.stack_trace'] = meta?.stack_trace || getStackTrace(this.config);

      // Add metadata if provided
      if (meta) {
        Object.keys(meta).forEach(key => {
          const value = meta[key];
          if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            attributes[`log.${key}`] = value;
          } else if (value !== null && value !== undefined) {
            // Convert complex types to JSON strings for proper serialization
            try {
              attributes[`log.${key}`] = JSON.stringify(value);
            } catch {
              // Fallback to String() if JSON.stringify fails (e.g., circular references)
              attributes[`log.${key}`] = String(value);
            }
          }
        });
      }

      // Store the event to be added before span ends
      if (!(span as any)._pendingLogEvents) {
        (span as any)._pendingLogEvents = [];
      }
      (span as any)._pendingLogEvents.push({
        name: `log.${level}`,
        attributes: attributes,
        timestamp: new Date(),
      });
    } catch {
      // Don't let event logging errors interfere with the application
    }
  }

  /**
   * Add logging metadata to the current span as attributes
   * This allows metadata to be searchable and filterable in tracing systems
   */
  private addMetadataToSpanAttributes(metadata: any): void {
    if (!metadata || Object.keys(metadata).length === 0) {
      return;
    }

    try {
      const span = otelTrace.getActiveSpan();
      if (!span || !span.isRecording()) {
        return;
      }

      // Filter and format metadata for span attributes
      const spanAttributes: Record<string, any> = {};

      Object.keys(metadata).forEach(key => {
        const value = metadata[key];
        // Only add primitive values as span attributes (strings, numbers, booleans)
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          // Use a consistent prefix for log metadata attributes
          spanAttributes[`log.metadata.${key}`] = value;
        } else if (value !== null && value !== undefined) {
          // Convert complex types to JSON strings for proper serialization
          try {
            spanAttributes[`log.metadata.${key}`] = JSON.stringify(value);
          } catch {
            // Fallback to String() if JSON.stringify fails (e.g., circular references)
            spanAttributes[`log.metadata.${key}`] = String(value);
          }
        }
      });

      // Set the attributes on the span
      if (Object.keys(spanAttributes).length > 0) {
        span.setAttributes(spanAttributes);
      }
    } catch {
      // Don't let attribute setting errors interfere with the application
    }
  }

  async debug(messageOrObj: string | any, ...args: any[]): Promise<void> {
    const { message, metadata } = this.processLogArgs(messageOrObj, ...args);
    const stackTrace = getStackTrace(this.config);
    const logData = { ...metadata, stack_trace: stackTrace };

    // Add metadata to span as attributes for searchability
    this.addMetadataToSpanAttributes(metadata);

    this.addSpanEventDirectly('debug', message, logData);

    // Increment span log count (handles log level filtering internally)
    this.incrementSpanLogCount('num_debug_logs', 'debug');

    // Log to console if enabled (pass only user metadata, not internal logData)
    this.logToConsole('debug', message, metadata);

    if (this.config.local_mode || !this.config.enable_log_cloud_export) {
      try {
        this.logger.debug(message, logData);
      } catch (error: any) {
        console.error('[TraceRoot] Logger debug error (local mode):', error?.message || error);
      }
      return;
    }

    await this.checkAndRefreshCredentials();

    try {
      this.logger.debug(message, logData);
    } catch (error: any) {
      console.error('[TraceRoot] Logger debug error (cloud mode):', error?.message || error);
    }
  }

  async info(messageOrObj: string | any, ...args: any[]): Promise<void> {
    const { message, metadata } = this.processLogArgs(messageOrObj, ...args);
    const stackTrace = getStackTrace(this.config);
    const logData = { ...metadata, stack_trace: stackTrace };

    // Add metadata to span as attributes for searchability
    this.addMetadataToSpanAttributes(metadata);

    this.addSpanEventDirectly('info', message, logData);

    // Increment span log count (handles log level filtering internally)
    this.incrementSpanLogCount('num_info_logs', 'info');

    // Log to console if enabled (pass only user metadata, not internal logData)
    this.logToConsole('info', message, metadata);

    if (this.config.local_mode || !this.config.enable_log_cloud_export) {
      try {
        this.logger.info(message, logData);
      } catch (error: any) {
        console.error('[TraceRoot] Logger info error (local mode):', error?.message || error);
      }
      return;
    }

    await this.checkAndRefreshCredentials();
    try {
      this.logger.info(message, logData);
    } catch (error: any) {
      console.error('[TraceRoot] Logger info error (cloud mode):', error?.message || error);
    }
  }

  async warn(messageOrObj: string | any, ...args: any[]): Promise<void> {
    const { message, metadata } = this.processLogArgs(messageOrObj, ...args);
    const stackTrace = getStackTrace(this.config);
    const logData = { ...metadata, stack_trace: stackTrace };

    // Add metadata to span as attributes for searchability
    this.addMetadataToSpanAttributes(metadata);

    this.addSpanEventDirectly('warn', message, logData);

    // Increment span log count (handles log level filtering internally)
    this.incrementSpanLogCount('num_warning_logs', 'warn');

    // Log to console if enabled (pass only user metadata, not internal logData)
    this.logToConsole('warn', message, metadata);

    if (this.config.local_mode || !this.config.enable_log_cloud_export) {
      try {
        this.logger.warn(message, logData);
      } catch (error: any) {
        console.error('[TraceRoot] Logger warn error (local mode):', error?.message || error);
      }
      return;
    }

    await this.checkAndRefreshCredentials();

    try {
      this.logger.warn(message, logData);
    } catch (error: any) {
      console.error('[TraceRoot] Logger warn error (cloud mode):', error?.message || error);
    }
  }

  async error(messageOrObj: string | any, ...args: any[]): Promise<void> {
    const { message, metadata } = this.processLogArgs(messageOrObj, ...args);
    const stackTrace = getStackTrace(this.config);
    const logData = { ...metadata, stack_trace: stackTrace };

    // Add metadata to span as attributes for searchability
    this.addMetadataToSpanAttributes(metadata);

    this.addSpanEventDirectly('error', message, logData);

    // Increment span log count (handles log level filtering internally)
    this.incrementSpanLogCount('num_error_logs', 'error');

    // Log to console if enabled (pass only user metadata, not internal logData)
    this.logToConsole('error', message, metadata);

    if (this.config.local_mode || !this.config.enable_log_cloud_export) {
      try {
        this.logger.error(message, logData);
      } catch (error: any) {
        console.error('[TraceRoot] Logger error error (local mode):', error?.message || error);
      }
      return;
    }

    await this.checkAndRefreshCredentials();

    try {
      this.logger.error(message, logData);
    } catch (error: any) {
      console.error('[TraceRoot] Logger error error (cloud mode):', error?.message || error);
    }
  }

  async critical(messageOrObj: string | any, ...args: any[]): Promise<void> {
    const { message, metadata } = this.processLogArgs(messageOrObj, ...args);
    const stackTrace = getStackTrace(this.config);
    const logData = { ...metadata, level: 'critical', stack_trace: stackTrace };

    // Add metadata to span as attributes for searchability
    this.addMetadataToSpanAttributes(metadata);

    this.addSpanEventDirectly('critical', message, logData);

    // Increment span log count (handles log level filtering internally)
    this.incrementSpanLogCount('num_critical_logs', 'critical');

    // Log to console if enabled (use 'error' level for critical in console, pass only user metadata)
    this.logToConsole('error', message, metadata);

    if (this.config.local_mode || !this.config.enable_log_cloud_export) {
      try {
        this.logger.error(message, logData);
      } catch (error: any) {
        console.error('[TraceRoot] Logger critical error (local mode):', error?.message || error);
      }
      return;
    }

    await this.checkAndRefreshCredentials();

    try {
      this.logger.error(message, logData);
    } catch (error: any) {
      console.error('[TraceRoot] Logger critical error (cloud mode):', error?.message || error);
    }
  }

  /**
   * Create a child logger with additional context
   * Child loggers inherit all parent functionality while adding persistent context
   *
   * @param context - Object with key-value pairs to add to all log entries
   * @returns A new TraceRootLogger instance with merged context
   */
  child(context: Record<string, any>): TraceRootLogger {
    // Create new child logger instance but skip transport setup
    const childLogger = Object.create(TraceRootLogger.prototype);
    Object.assign(childLogger, {
      config: this.config,
      loggerName: this.loggerName,
      logger: this.getRootLogger().logger, // Share logger instance with root
      consoleLogger: this.getRootLogger().consoleLogger, // Share console logger
      cloudWatchTransport: null, // Child doesn't manage transports
    });

    // Set up child context by merging parent context with new context
    childLogger.childContext = { ...this.childContext, ...context };

    // Set parent reference for credential delegation
    childLogger.parentLogger = this;

    return childLogger;
  }

  /**
   * Get the root logger for credential management
   * Walks up the parent chain to find the root logger
   */
  private getRootLogger(): TraceRootLogger {
    return this.parentLogger?.getRootLogger() ?? this;
  }

  /**
   * Flush all pending log messages to their destinations
   * Only resolves when ALL logs are actually sent - no timeouts
   * Child loggers delegate to root logger for flushing
   */
  async flush(): Promise<void> {
    // If this is a child logger, delegate to root logger
    if (this.parentLogger) {
      return this.getRootLogger().flush();
    }

    // If cloud export is disabled or we're in local mode, there's nothing to flush
    if (this.config.local_mode || !this.config.enable_log_cloud_export) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      const cloudWatchTransports = this.logger.transports.filter(
        (transport: any) => transport.constructor.name === 'WinstonCloudWatch'
      );

      // If no CloudWatch transports, resolve immediately
      if (cloudWatchTransports.length === 0) {
        resolve();
        return;
      }

      let completedTransports = 0;
      const totalTransports = cloudWatchTransports.length;

      const onTransportComplete = () => {
        completedTransports++;
        if (completedTransports === totalTransports) {
          resolve(); // Only resolve when ALL transports are done
        }
      };

      // Flush each CloudWatch transport
      cloudWatchTransports.forEach((transport: any) => {
        if (typeof transport.kthxbye === 'function') {
          // Use winston-cloudwatch's proper flush method
          transport.kthxbye(onTransportComplete);
        } else {
          // If no flush method available, mark as complete
          onTransportComplete();
        }
      });
    });
  }
}

// Global configuration instance
let _globalConfig: TraceRootConfigImpl | null = null;

/**
 * Set the global configuration for all loggers
 * This is called by TraceRoot.init() to set up the shared config
 */
export function setGlobalConfig(config: TraceRootConfigImpl): void {
  _globalConfig = config;
}

// Logger registry for module-based instances
const _loggerRegistry: Map<string, TraceRootLogger> = new Map();

// Default module name for when no module name is provided
const DEFAULT_MODULE_NAME = '__default__';

// Global credential refresh state to ensure only one refresh happens at a time
let _credentialsRefreshPromise: Promise<AwsCredentials | null> | null = null;

/**
 * Global credential refresh function - ensures all loggers share the same credentials
 * and only one refresh happens at a time across all logger instances
 */
async function checkAndRefreshGlobalCredentials(): Promise<AwsCredentials | null> {
  if (!_globalConfig) {
    return null;
  }

  // If we're in local mode or cloud export is disabled, no credentials needed
  if (
    _globalConfig.local_mode ||
    !_globalConfig.enable_span_cloud_export ||
    !_globalConfig.enable_log_cloud_export
  ) {
    return null;
  }

  // Get current credentials from global config
  let credentials: AwsCredentials | null = (_globalConfig as any)._awsCredentials || null;

  if (!credentials) {
    return null;
  }

  // Check if credentials are expired (30 minutes before actual expiration)
  const now = new Date();
  const expirationTime = credentials.expiration_utc;
  const bufferTime = 30 * 60 * 1000; // 30 minutes in milliseconds

  // If no expiration time, treat credentials as valid
  if (!expirationTime) {
    return credentials;
  }

  if (now.getTime() >= expirationTime.getTime() - bufferTime) {
    console.log('[TraceRoot] AWS credentials expired or expiring soon, refreshing...');

    // If there's already a refresh in progress, wait for it
    if (_credentialsRefreshPromise) {
      return await _credentialsRefreshPromise;
    }

    // Start a new refresh
    _credentialsRefreshPromise = refreshGlobalCredentials();
    try {
      const newCredentials = await _credentialsRefreshPromise;
      return newCredentials;
    } finally {
      _credentialsRefreshPromise = null;
    }
  }

  return credentials;
}

/**
 * Refresh AWS credentials globally - updates the global config so all loggers see new credentials
 */
async function refreshGlobalCredentials(): Promise<AwsCredentials | null> {
  if (!_globalConfig || !_globalConfig.token) {
    console.log('[TraceRoot] No token provided, cannot refresh credentials');
    return null;
  }

  try {
    const apiUrl = `${API_ENDPOINTS.VERIFY_CREDENTIALS}?token=${encodeURIComponent(_globalConfig.token)}`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const credentialsData = (await response.json()) as AwsCredentials;

    // Ensure expiration_utc is properly parsed as UTC Date
    if (credentialsData.expiration_utc) {
      const expirationValue = credentialsData.expiration_utc as any;
      const utcString =
        typeof expirationValue === 'string'
          ? expirationValue.endsWith('Z')
            ? expirationValue
            : expirationValue + 'Z'
          : expirationValue;
      credentialsData.expiration_utc = new Date(utcString) as any;
    }

    // Update global config with new credentials - all loggers will see this update
    (_globalConfig as any)._name = credentialsData.hash;
    (_globalConfig as any).otlp_endpoint = credentialsData.otlp_endpoint;
    (_globalConfig as any)._awsCredentials = credentialsData;

    // Recreate CloudWatch transports for ALL loggers with new credentials
    for (const logger of _loggerRegistry.values()) {
      try {
        (logger as any).recreateCloudWatchTransport(credentialsData);
      } catch (error: any) {
        console.error(
          '[TraceRoot] Failed to recreate CloudWatch transport for logger:',
          error?.message || error
        );
      }
    }

    console.log('[TraceRoot] Global credentials refreshed successfully');
    return credentialsData;
  } catch (error: any) {
    console.error('[TraceRoot] Failed to refresh AWS credentials:', error.message);
    return null;
  }
}

/**
 * Get a logger instance for the specified module or default module
 * @param name Optional module name - if provided, returns a cached logger for that module
 * @param logLevel Optional log level override - if provided, overrides config log level
 */
export function getLogger(
  name?: string,
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent'
): TraceRootLogger {
  if (_globalConfig === null) {
    throw new Error('Logger not initialized. Call TraceRoot.init() first.');
  }

  // Use default module name if none provided (for backward compatibility)
  const moduleName = name || DEFAULT_MODULE_NAME;

  // Create a cache key that includes both name and logLevel (if provided)
  const cacheKey = logLevel ? `${moduleName}:${logLevel}` : moduleName;

  // Check if we already have a logger for this module (and log level combination)
  if (_loggerRegistry.has(cacheKey)) {
    return _loggerRegistry.get(cacheKey)!;
  }

  // Create a new logger instance for this module
  // All loggers should reference the same global config object to share credentials
  // This ensures when credentials are refreshed in one logger, all loggers see the update
  const configWithOverride = logLevel
    ? {
        ..._globalConfig,
        log_level: logLevel,
      }
    : _globalConfig; // Use the global config directly when no override needed

  // For the default module, use the service name as the logger name
  const loggerName = name || _globalConfig.service_name;
  const moduleLogger = TraceRootLogger.create(configWithOverride, loggerName);

  // Cache the logger instance
  _loggerRegistry.set(cacheKey, moduleLogger);

  return moduleLogger;
}

/**
 * Get the global logger instance or create a new one
 * @param name Optional logger name (currently unused, reserved for future use)
 * @param logLevel Optional log level override - if provided, overrides config log level
 * @deprecated Use getLogger() instead. This function will be removed in a future version.
 */
export function get_logger(
  name?: string,
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent'
): TraceRootLogger {
  return getLogger(name, logLevel);
}

/**
 * Flush all pending logs to their destinations for ALL logger instances.
 * Works for both sync and async usage.
 */
export function forceFlushLogger(): Promise<void> {
  if (_loggerRegistry.size === 0) {
    return Promise.resolve();
  }

  // Flush all logger instances in parallel
  const flushPromises: Promise<void>[] = [];
  for (const logger of _loggerRegistry.values()) {
    flushPromises.push(logger.flush());
  }

  return Promise.all(flushPromises).then(() => {});
}

/**
 * Shutdown all logger transports and stop background processes for ALL logger instances.
 * Works for both sync and async usage.
 */
export async function shutdownLogger(): Promise<void> {
  if (_loggerRegistry.size === 0) {
    return;
  }

  try {
    // First flush all logs from all logger instances
    await forceFlushLogger();
  } catch (error) {
    // Ignore flush errors to prevent hanging during shutdown
    console.warn('[TraceRoot] Logger flush failed during shutdown (non-critical):', error);
  }

  // Then shutdown transports for all loggers
  for (const logger of _loggerRegistry.values()) {
    const transports = (logger as any).logger.transports;
    transports.forEach((transport: any) => {
      try {
        if (typeof transport.close === 'function') {
          transport.close();
        }
        if (typeof transport.end === 'function') {
          transport.end();
        }
      } catch (error) {
        // Ignore shutdown errors
        void error;
      }
    });

    // Also shutdown console logger if it exists
    const consoleLogger = (logger as any).consoleLogger;
    if (consoleLogger) {
      const consoleTransports = consoleLogger.transports;
      consoleTransports.forEach((transport: any) => {
        try {
          if (typeof transport.close === 'function') {
            transport.close();
          }
          if (typeof transport.end === 'function') {
            transport.end();
          }
        } catch (error) {
          // Ignore shutdown errors
          void error;
        }
      });
      consoleTransports.length = 0;
    }

    // Clear transport arrays
    transports.length = 0;
  }

  // Clear everything
  _globalConfig = null;
  _loggerRegistry.clear();
}

/**
 * Synchronous version of forceFlushLogger for ALL logger instances.
 * For console transports, uses a blocking wait to ensure logs appear in sync contexts.
 */
export function forceFlushLoggerSync(): void {
  if (_loggerRegistry.size === 0) {
    return;
  }

  // Check configuration from global config
  if (!_globalConfig) {
    return;
  }

  // If cloud export is disabled, there's nothing to flush asynchronously
  if (_globalConfig.local_mode || !_globalConfig.enable_log_cloud_export) {
    // For console logger in sync contexts, give it a small delay to ensure output appears
    // Check if any logger has a console logger
    let hasConsoleLogger = false;
    for (const logger of _loggerRegistry.values()) {
      if ((logger as any).consoleLogger) {
        hasConsoleLogger = true;
        break;
      }
    }

    if (hasConsoleLogger) {
      const start = Date.now();
      while (Date.now() - start < 100) {
        // Brief blocking delay for console output
      }
    }
    return;
  }

  // Check if any logger has console or CloudWatch transports
  let hasConsoleTransport = false;
  let hasCloudWatchTransport = false;

  for (const logger of _loggerRegistry.values()) {
    const transports = (logger as any).logger.transports;
    if (transports.some((t: any) => t.constructor.name === 'Console')) {
      hasConsoleTransport = true;
    }
    if (transports.some((t: any) => t.constructor.name === 'WinstonCloudWatch')) {
      hasCloudWatchTransport = true;
    }
  }

  if (hasConsoleTransport) {
    // For console transports in sync contexts, we need to wait for the async logging to complete
    // Use a longer blocking delay to ensure console output appears
    const start = Date.now();
    while (Date.now() - start < 200) {
      // Blocking delay for console output
    }
  }

  // Start async flush for CloudWatch transports (don't wait)
  if (hasCloudWatchTransport) {
    const flushPromise = forceFlushLogger();
    flushPromise
      .then(() => {})
      .catch((error: any) => {
        void error;
      });
  }
}

/**
 * Synchronous version of shutdownLogger.
 * Starts the shutdown process but doesn't wait for completion.
 */
export function shutdownLoggerSync(): void {
  const shutdownPromise = shutdownLogger();
  shutdownPromise
    .then(() => {})
    .catch((error: any) => {
      void error;
    });
}
