/**
 * Enhanced logging with automatic trace correlation
 */

import * as winston from 'winston';
import WinstonCloudWatch from 'winston-cloudwatch';
import { trace as otelTrace } from '@opentelemetry/api';
import { TraceRootConfigImpl } from './config';
import { AwsCredentials } from './types';

/**
 * Custom Winston format for trace correlation
 */
const traceCorrelationFormat = (config: TraceRootConfigImpl, loggerName: string) => {
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
                  attributes[`log.${key}`] = String(value);
                  metadataForSpanAttributes[key] = String(value);
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
  private logger: winston.Logger;
  private consoleLogger: winston.Logger | null = null; // Separate logger for console output
  private config: TraceRootConfigImpl;
  private loggerName: string;
  private credentialsRefreshPromise: Promise<AwsCredentials | null> | null = null;
  private cloudWatchTransport: WinstonCloudWatch | null = null;

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

    this.logger = winston.createLogger({
      level: !config.enable_log_console_export ? 'silent' : 'debug',
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
   * Returns the current valid credentials or null if no credentials available
   */
  private async checkAndRefreshCredentials(): Promise<AwsCredentials | null> {
    // If we're in local mode or cloud export is disabled, no credentials needed
    if (this.config.local_mode || !this.config.enable_log_cloud_export) {
      return null;
    }

    // Get current credentials
    let credentials: AwsCredentials | null = (this.config as any)._awsCredentials || null;

    if (!credentials) {
      return null;
    }

    // Check if credentials are expired (10 minutes before actual expiration)
    const now = new Date();
    const expirationTime = new Date(credentials.expiration_utc);
    const bufferTime = 10 * 60 * 1000; // 10 minutes in milliseconds

    if (now.getTime() >= expirationTime.getTime() - bufferTime) {
      console.log('[TraceRoot] AWS credentials expired or expiring soon, refreshing...');

      // If there's already a refresh in progress, wait for it
      if (this.credentialsRefreshPromise) {
        return await this.credentialsRefreshPromise;
      }

      // Start a new refresh
      this.credentialsRefreshPromise = this.refreshCredentials();
      try {
        const newCredentials = await this.credentialsRefreshPromise;
        return newCredentials;
      } finally {
        this.credentialsRefreshPromise = null;
      }
    }

    return credentials;
  }

  /**
   * Recreate CloudWatch transport with new credentials
   */
  private recreateCloudWatchTransport(credentials: AwsCredentials): void {
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
        level: 'debug',
        jsonMessage: true,
        uploadRate: 2000,
        errorHandler: (err: any) => {
          console.error('[ERROR] CloudWatch transport errorHandler:', err);
        },
        messageFormatter: (item: any) => this.formatCloudWatchMessage(item),
      });

      // Add error handling for the new transport
      newCloudWatchTransport.on('error', (error: any) => {
        console.error('[ERROR] CloudWatch transport error:', error.message);
        console.error('[ERROR] CloudWatch error details:', error);
        if (error.code) {
          console.error('[ERROR] CloudWatch error code:', error.code);
        }
        if (error.statusCode) {
          console.error('[ERROR] CloudWatch status code:', error.statusCode);
        }
      });

      // Add the new transport to the logger
      this.logger.add(newCloudWatchTransport);

      // Update the reference to the new transport
      this.cloudWatchTransport = newCloudWatchTransport;

      console.log('[TraceRoot] Successfully recreated CloudWatch transport with new credentials');
    } catch (error: any) {
      console.error('[TraceRoot] Failed to recreate CloudWatch transport:', error.message);
    }
  }

  /**
   * Refresh AWS credentials by calling the verify API
   */
  private async refreshCredentials(): Promise<AwsCredentials | null> {
    if (!this.config.token) {
      console.log('[TraceRoot] No token provided, cannot refresh credentials');
      return null;
    }

    try {
      const apiUrl = `https://api.test.traceroot.ai/v1/verify/credentials?token=${encodeURIComponent(this.config.token)}`;

      // Use fetch for async HTTP request
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

      // Update config with new credentials
      this.config._name = credentialsData.hash;
      this.config.otlp_endpoint = credentialsData.otlp_endpoint;
      (this.config as any)._awsCredentials = credentialsData;

      // Recreate CloudWatch transport with new credentials
      this.recreateCloudWatchTransport(credentialsData);

      return credentialsData;
    } catch (error: any) {
      console.error('[TraceRoot] Failed to refresh AWS credentials:', error.message);
      return null;
    }
  }

  private setupTransports(): void {
    // Console logger for debugging (works in both local and non-local modes)
    if (this.config.enable_log_console_export) {
      // Create a separate logger specifically for console output - simple format with just user data
      this.consoleLogger = winston.createLogger({
        level: 'debug',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize(),
          winston.format.printf((info: any) => {
            // Simple console format - just timestamp, level, message, and user metadata
            const userMeta = Object.keys(info)
              .filter(key => !['level', 'message', 'timestamp'].includes(key))
              .reduce((obj, key) => {
                obj[key] = info[key];
                return obj;
              }, {} as any);

            const metaStr = Object.keys(userMeta).length > 0 ? ` ${JSON.stringify(userMeta)}` : '';
            return `${info.timestamp} [${info.level}] ${info.message}${metaStr}`;
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

    // Setup appropriate transport based on mode and cloud export setting
    if (!this.config.local_mode && this.config.enable_log_cloud_export) {
      this.setupCloudWatchTransport();
    } else {
      this.setupLocalTransport();
    }
  }

  private setupCloudWatchTransport(): void {
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
        level: 'debug', // TODO: explicitly set log level
        jsonMessage: true, // Enable JSON formatting to use our custom formatter
        uploadRate: 1000, // Upload every 1 second
        messageFormatter: (item: any) => this.formatCloudWatchMessage(item),
      });
      this.logger.add(this.cloudWatchTransport);
    } catch (error: any) {
      void error;
    }
  }

  private setupLocalTransport(): void {
    // For local mode or when cloud export is disabled, logs are handled by:
    // 1. Console output (if enable_log_console_export is true, handled in setupTransports)
    // 2. Direct span events (handled in addSpanEventDirectly)

    // Always add a minimal null transport to prevent Winston warnings
    // Create a simple transport that does nothing but prevents "no transports" error
    const nullTransport = new winston.transports.Console({
      level: 'silent', // Set to silent to minimize processing
      silent: true, // Make it completely silent
    });
    this.logger.add(nullTransport);
  }

  private incrementSpanLogCount(attributeName: string): void {
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
      // Pass only the user-provided metadata (from processLogArgs)
      (this.consoleLogger as any)[level](message, userMetadata || {});
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
   */
  private processLogArgs(
    messageOrObj: string | any,
    ...args: any[]
  ): { message: string; metadata: any } {
    let message: string;
    let metadata: any = {};
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

    // Merge all collected objects
    if (objects.length > 0) {
      metadata = objects.reduce((merged, obj) => ({ ...merged, ...obj }), {});
    }

    // Set the message
    message = foundMessage || 'Log entry';

    return { message, metadata };
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
            attributes[`log.${key}`] = String(value);
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
          // Convert complex types to strings
          spanAttributes[`log.metadata.${key}`] = String(value);
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

    // Log to console if enabled (pass only user metadata, not internal logData)
    this.logToConsole('debug', message, metadata);

    if (this.config.local_mode || !this.config.enable_log_cloud_export) {
      this.logger.debug(message, logData);
      this.incrementSpanLogCount('num_debug_logs');
      return;
    }

    await this.checkAndRefreshCredentials();

    this.logger.debug(message, logData);
    this.incrementSpanLogCount('num_debug_logs');
  }

  async info(messageOrObj: string | any, ...args: any[]): Promise<void> {
    const { message, metadata } = this.processLogArgs(messageOrObj, ...args);
    const stackTrace = getStackTrace(this.config);
    const logData = { ...metadata, stack_trace: stackTrace };

    // Add metadata to span as attributes for searchability
    this.addMetadataToSpanAttributes(metadata);

    this.addSpanEventDirectly('info', message, logData);

    // Log to console if enabled (pass only user metadata, not internal logData)
    this.logToConsole('info', message, metadata);

    if (this.config.local_mode || !this.config.enable_log_cloud_export) {
      this.logger.info(message, logData);
      this.incrementSpanLogCount('num_info_logs');
      return;
    }

    await this.checkAndRefreshCredentials();
    this.logger.info(message, logData);
    this.incrementSpanLogCount('num_info_logs');
  }

  async warn(messageOrObj: string | any, ...args: any[]): Promise<void> {
    const { message, metadata } = this.processLogArgs(messageOrObj, ...args);
    const stackTrace = getStackTrace(this.config);
    const logData = { ...metadata, stack_trace: stackTrace };

    // Add metadata to span as attributes for searchability
    this.addMetadataToSpanAttributes(metadata);

    this.addSpanEventDirectly('warn', message, logData);

    // Log to console if enabled (pass only user metadata, not internal logData)
    this.logToConsole('warn', message, metadata);

    if (this.config.local_mode || !this.config.enable_log_cloud_export) {
      this.logger.warn(message, logData);
      this.incrementSpanLogCount('num_warning_logs');
      return;
    }

    await this.checkAndRefreshCredentials();

    this.logger.warn(message, logData);
    this.incrementSpanLogCount('num_warning_logs');
  }

  async error(messageOrObj: string | any, ...args: any[]): Promise<void> {
    const { message, metadata } = this.processLogArgs(messageOrObj, ...args);
    const stackTrace = getStackTrace(this.config);
    const logData = { ...metadata, stack_trace: stackTrace };

    // Add metadata to span as attributes for searchability
    this.addMetadataToSpanAttributes(metadata);

    this.addSpanEventDirectly('error', message, logData);

    // Log to console if enabled (pass only user metadata, not internal logData)
    this.logToConsole('error', message, metadata);

    if (this.config.local_mode || !this.config.enable_log_cloud_export) {
      this.logger.error(message, logData);
      this.incrementSpanLogCount('num_error_logs');
      return;
    }

    await this.checkAndRefreshCredentials();

    this.logger.error(message, logData);
    this.incrementSpanLogCount('num_error_logs');
  }

  async critical(messageOrObj: string | any, ...args: any[]): Promise<void> {
    const { message, metadata } = this.processLogArgs(messageOrObj, ...args);
    const stackTrace = getStackTrace(this.config);
    const logData = { ...metadata, level: 'critical', stack_trace: stackTrace };

    // Add metadata to span as attributes for searchability
    this.addMetadataToSpanAttributes(metadata);

    this.addSpanEventDirectly('critical', message, logData);

    // Log to console if enabled (use 'error' level for critical in console, pass only user metadata)
    this.logToConsole('error', message, metadata);

    if (this.config.local_mode || !this.config.enable_log_cloud_export) {
      this.logger.error(message, logData);
      this.incrementSpanLogCount('num_critical_logs');
      return;
    }

    await this.checkAndRefreshCredentials();

    this.logger.error(message, logData);
    this.incrementSpanLogCount('num_critical_logs');
  }

  /**
   * Flush all pending log messages to their destinations
   * Only resolves when ALL logs are actually sent - no timeouts
   */
  async flush(): Promise<void> {
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

// Global logger instance
let _globalLogger: TraceRootLogger | null = null;

/**
 * Initialize the global logger instance (synchronous)
 */
export function initializeLogger(config: TraceRootConfigImpl): TraceRootLogger {
  _globalLogger = TraceRootLogger.create(config);
  return _globalLogger;
}

/**
 * Get the global logger instance or create a new one
 */
export function get_logger(name?: string): TraceRootLogger {
  if (_globalLogger === null) {
    throw new Error('Logger not initialized. Call TraceRoot.init() first.');
  }

  if (name === undefined) {
    return _globalLogger;
  }
  return _globalLogger;
}

/**
 * Flush all pending logs to their destinations.
 * Works for both sync and async usage.
 */
export function forceFlushLogger(): Promise<void> {
  if (_globalLogger) {
    return _globalLogger.flush();
  } else {
    return Promise.resolve();
  }
}

/**
 * Shutdown all logger transports and stop background processes.
 * Works for both sync and async usage.
 */
export async function shutdownLogger(): Promise<void> {
  if (!_globalLogger) {
    return;
  }

  try {
    // First flush all logs (this already handles the case where cloud export is disabled)
    await _globalLogger.flush();
  } catch (error) {
    // Ignore flush errors to prevent hanging during shutdown
    console.warn('[TraceRoot] Logger flush failed during shutdown (non-critical):', error);
  }

  // Then shutdown transports
  const transports = (_globalLogger as any).logger.transports;
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
  const consoleLogger = (_globalLogger as any).consoleLogger;
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

  // Clear everything
  transports.length = 0;
  _globalLogger = null;
}

/**
 * Synchronous version of forceFlushLogger.
 * For console transports, uses a blocking wait to ensure logs appear in sync contexts.
 */
export function forceFlushLoggerSync(): void {
  if (!_globalLogger) {
    return;
  }

  // If cloud export is disabled, there's nothing to flush asynchronously
  if (
    (_globalLogger as any).config.local_mode ||
    !(_globalLogger as any).config.enable_log_cloud_export
  ) {
    // For console logger in sync contexts, give it a small delay to ensure output appears
    if ((_globalLogger as any).consoleLogger) {
      const start = Date.now();
      while (Date.now() - start < 100) {
        // Brief blocking delay for console output
      }
    }
    return;
  }

  const transports = (_globalLogger as any).logger.transports;
  const hasConsoleTransport = transports.some((t: any) => t.constructor.name === 'Console');
  const hasCloudWatchTransport = transports.some(
    (t: any) => t.constructor.name === 'WinstonCloudWatch'
  );

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
