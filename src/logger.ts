/**
 * Enhanced logging with automatic trace correlation
 */

import * as winston from 'winston';
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import WinstonCloudWatch from 'winston-cloudwatch-logs';
import { trace as otelTrace } from '@opentelemetry/api';
import axios from 'axios';
import { TraceRootConfigImpl } from './config';

interface AwsCredentials {
  aws_access_key_id: string;
  aws_secret_access_key: string;
  aws_session_token: string;
  region: string;
  hash: string;
  otlp_endpoint: string;
}

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
                } else if (value !== null && value !== undefined) {
                  attributes[`log.${key}`] = String(value);
                }
              }
            });

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
 * Get a clean stack trace showing the call path
 */
function getStackTrace(): string {
  const stack = new Error().stack;
  if (!stack) return 'unknown';

  const stackLines = stack.split('\n');
  console.log('!!!!!stackLines', stackLines);
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
      line.includes('logform')
    ) {
      continue;
    }

    // Extract meaningful information from stack trace
    const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
    if (match) {
      const [, functionName, filepath, lineNumber] = match;

      // Get a meaningful relative path instead of just the filename
      let relativePath = filepath;

      // If it's an absolute path, try to make it relative to common project roots
      if (filepath.startsWith('/')) {
        // Look for common project indicators and extract path from there
        const projectIndicators = ['/src/', '/examples/', '/test/', '/tests/', '/lib/', '/dist/'];
        for (const indicator of projectIndicators) {
          const index = filepath.indexOf(indicator);
          if (index !== -1) {
            relativePath = filepath.substring(index + 1); // +1 to remove the leading slash
            break;
          }
        }

        // If no project indicator found, try to get the last 2-3 path segments
        if (relativePath === filepath) {
          const pathParts = filepath.split('/');
          if (pathParts.length > 2) {
            relativePath = pathParts.slice(-2).join('/');
          } else {
            relativePath = pathParts[pathParts.length - 1];
          }
        }
      }

      // Skip tracing and logging module frames
      if (
        relativePath.includes('tracer.') ||
        relativePath.includes('logger.') ||
        relativePath.includes('winston') ||
        relativePath.includes('node_modules')
      ) {
        continue;
      }

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
  private config: TraceRootConfigImpl;
  private loggerName: string;

  private constructor(config: TraceRootConfigImpl, name?: string) {
    this.config = config;
    this.loggerName = name || config.service_name;

    this.logger = winston.createLogger({
      level: 'debug',
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

    console.log(`[DEBUG] Winston logger created with level: ${this.logger.level}`);
    console.log(`[DEBUG] Logger default meta:`, this.logger.defaultMeta);
  }

  /**
   * Static async factory method to create and initialize logger
   */
  static async create(config: TraceRootConfigImpl, name?: string): Promise<TraceRootLogger> {
    const logger = new TraceRootLogger(config, name);
    await logger.setupTransports();
    return logger;
  }

  private async setupTransports(): Promise<void> {
    // Console transport for debugging (works in both local and non-local modes)
    if (this.config.enable_log_console_export) {
      this.logger.add(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.colorize(),
            winston.format.printf((info: any) => {
              // Format for console output
              const meta = Object.keys(info)
                .filter(
                  key =>
                    ![
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
                    ].includes(key)
                )
                .reduce((obj, key) => {
                  obj[key] = info[key];
                  return obj;
                }, {} as any);

              const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
              const traceInfo = info.trace_id !== 'no-trace' ? ` [trace:${info.trace_id}]` : '';
              return `${info.timestamp} [${info.level.toUpperCase()}]${traceInfo} ${info.message}${metaStr}`;
            })
          ),
        })
      );
    }

    // Setup appropriate transport based on mode
    if (!this.config.local_mode) {
      await this.setupCloudWatchTransport();
    } else {
      this.setupLocalTransport();
    }
  }

  private async fetchAwsCredentials(): Promise<AwsCredentials | null> {
    try {
      const response = await axios.get('https://api.test.traceroot.ai/v1/verify/credentials', {
        params: { token: this.config.token },
        headers: { 'Content-Type': 'application/json' },
      });
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to fetch AWS credentials', { error: error.message });
      return null;
    }
  }

  private async setupCloudWatchTransport(): Promise<void> {
    try {
      // Check if credentials were already fetched during tracer initialization
      let credentials: AwsCredentials | null = (this.config as any)._awsCredentials || null;

      // If no credentials stored, fetch them (fallback for edge cases)
      if (!credentials) {
        credentials = await this.fetchAwsCredentials();

        if (credentials) {
          // Update config with fetched credentials
          this.config._name = credentials.hash;
          this.config.otlp_endpoint = credentials.otlp_endpoint;
        }
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
        console.log(`[DEBUG] AWS credentials configured for SDK v3, region: ${credentials.region}`);
      }

      const logGroupName = this.config._name || this.config.service_name;
      const logStreamName =
        this.config._sub_name || `${this.config.service_name}-${this.config.environment}`;
      const awsRegion = credentials?.region || this.config.aws_region;

      console.log(
        `[TraceRoot] CloudWatch logging enabled - LogGroup: ${logGroupName}, Region: ${awsRegion}`
      );

      // Test CloudWatch access (optional - don't fail if permissions are limited)
      try {
        await this.testCloudWatchAccess(logGroupName, logStreamName, awsConfig);
      } catch (error: any) {
        console.log(
          `[DEBUG] CloudWatch access test failed (this is OK if permissions are limited): ${error.message}`
        );
        console.log('[DEBUG] Proceeding with winston-cloudwatch-logs transport setup...');
      }

      // Create CloudWatch transport using winston-cloudwatch-logs
      const cloudWatchTransport = new WinstonCloudWatch({
        logGroupName: logGroupName,
        logStreamName: logStreamName,
        // Use the winston-cloudwatch-logs credential format
        awsOptions: awsConfig, // Pass the entire config object
        level: 'debug', // Explicitly set log level
        jsonMessage: false, // Disable JSON formatting to use our custom formatter
        uploadRate: 2000, // Upload every 2 seconds
        errorHandler: (err: any) => {
          console.error('[ERROR] CloudWatch transport errorHandler:', err);
        },
        messageFormatter: (item: any) => {
          console.log(
            `[DEBUG] CloudWatch messageFormatter called for: ${item.level} - ${item.message}`
          );

          // Format according to Python logging format:
          // %(asctime)s;%(levelname)s;%(service_name)s;%(github_commit_hash)s;%(github_owner)s;%(github_repo_name)s;%(environment)s;%(trace_id)s;%(span_id)s;%(stack_trace)s;%(message)s
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

          console.log(`[DEBUG] CloudWatch formatted message:`, formattedMessage);
          return formattedMessage;
        },
      });

      // Add comprehensive error handling for CloudWatch transport
      cloudWatchTransport.on('error', (error: any) => {
        console.error('[ERROR] CloudWatch transport error:', error.message);
        console.error('[ERROR] CloudWatch error details:', error);
        if (error.code) {
          console.error('[ERROR] CloudWatch error code:', error.code);
        }
        if (error.statusCode) {
          console.error('[ERROR] CloudWatch status code:', error.statusCode);
        }
      });

      cloudWatchTransport.on('logged', (info: any) => {
        console.log(
          '[DEBUG] Successfully logged to CloudWatch:',
          info.level,
          (info.message || '').substring(0, 50) + '...'
        );
      });

      // Add debug event to see what's being sent
      (cloudWatchTransport as any).on(
        'logging',
        (transport: any, level: string, msg: string, meta: any) => {
          console.log(
            `[DEBUG] CloudWatch transport attempting to log: ${level} - ${msg.substring(0, 50)} ${meta.stack_trace}...`
          );
        }
      );

      // Add more event listeners to debug the CloudWatch transport
      ['open', 'close', 'flush', 'rotating'].forEach(eventName => {
        (cloudWatchTransport as any).on(eventName, (...args: any[]) => {
          console.log(
            `[DEBUG] CloudWatch transport event '${eventName}':`,
            args.length > 0 ? args[0] : 'no args'
          );
        });
      });

      // Test the CloudWatch transport explicitly
      console.log('[DEBUG] Testing CloudWatch transport directly...');
      (cloudWatchTransport as any).log(
        { level: 'info', message: 'Direct transport test' },
        (err?: any) => {
          if (err) {
            console.error('[ERROR] Direct CloudWatch transport test failed:', err);
          } else {
            console.log('[DEBUG] Direct CloudWatch transport test succeeded');
          }
        }
      );

      this.logger.add(cloudWatchTransport);

      console.log('[DEBUG] CloudWatch transport added successfully');
      console.log(
        `[DEBUG] Logger now has ${this.logger.transports.length} transports:`,
        this.logger.transports.map((t: any) => t.constructor.name)
      );

      // Add checkpoint message AFTER transport is ready
      console.log('[DEBUG] Sending test message to verify CloudWatch transport...');
      this.logger.info('CloudWatch transport is ready - checkpoint message');

      // Check that the winston logger can send logs
      console.log('[DEBUG] Testing winston logger directly...');
      console.log(`[DEBUG] Winston logger level: ${this.logger.level}`);
      console.log(
        `[DEBUG] Winston logger transports:`,
        this.logger.transports.map(
          (t: any) => `${t.constructor.name}(level: ${t.level || 'inherit'})`
        )
      );

      // Test if winston can log at info level
      const canLogInfo = this.logger.isLevelEnabled('info');
      console.log(`[DEBUG] Winston can log info level: ${canLogInfo}`);

      // Add a winston logger event listener to see what's happening
      this.logger.on('data', (info: any) => {
        console.log(
          '[DEBUG] Winston logger data event:',
          info.level,
          info.message?.substring(0, 50)
        );
      });

      this.logger.on('error', (err: any) => {
        console.error('[ERROR] Winston logger error:', err);
      });

      // Test winston logger with a direct info log after setup
      console.log('[DEBUG] Testing winston logger with direct log...');
      this.logger.info('Winston direct test after setup', { test: true });
    } catch (error: any) {
      console.error('[ERROR] Failed to setup CloudWatch logging:', error.message);
      this.logger.error('Failed to setup CloudWatch logging', { error: error.message });
    }
  }

  /**
   * Test CloudWatch access by trying to create log group and stream
   */
  private async testCloudWatchAccess(
    logGroupName: string,
    logStreamName: string,
    awsConfig: any
  ): Promise<void> {
    try {
      console.log('[DEBUG] Testing CloudWatch API access...');

      const cloudWatchLogs = new CloudWatchLogsClient(awsConfig);

      // Test 1: Try to describe log groups (this will test basic permissions)
      try {
        const describeResult = await cloudWatchLogs.send(
          new DescribeLogGroupsCommand({
            logGroupNamePrefix: logGroupName,
            limit: 1,
          })
        );
        console.log('[DEBUG] CloudWatch API access OK - can describe log groups');

        // Check if our log group exists
        const logGroupExists = describeResult.logGroups?.some(
          (lg: any) => lg.logGroupName === logGroupName
        );
        console.log(`[DEBUG] Log group ${logGroupName} exists: ${logGroupExists}`);

        if (!logGroupExists) {
          console.log('[DEBUG] Creating log group...');
          await cloudWatchLogs.send(new CreateLogGroupCommand({ logGroupName }));
          console.log('[DEBUG] Log group created successfully');
        }
      } catch (error: any) {
        if (error.name === 'ResourceAlreadyExistsException') {
          console.log('[DEBUG] Log group already exists');
        } else {
          console.error('[ERROR] Failed to create log group:', error.message);
          throw error;
        }
      }

      // Test 2: Try to create/check log stream
      try {
        console.log('[DEBUG] Checking log stream...');
        const streamsResult = await cloudWatchLogs.send(
          new DescribeLogStreamsCommand({
            logGroupName,
            logStreamNamePrefix: logStreamName,
            limit: 1,
          })
        );

        const streamExists = streamsResult.logStreams?.some(
          (ls: any) => ls.logStreamName === logStreamName
        );
        console.log(`[DEBUG] Log stream ${logStreamName} exists: ${streamExists}`);

        if (!streamExists) {
          console.log('[DEBUG] Creating log stream...');
          await cloudWatchLogs.send(
            new CreateLogStreamCommand({
              logGroupName,
              logStreamName,
            })
          );
          console.log('[DEBUG] Log stream created successfully');
        }
      } catch (error: any) {
        if (error.name === 'ResourceAlreadyExistsException') {
          console.log('[DEBUG] Log stream already exists');
        } else {
          console.error('[ERROR] Failed to create log stream:', error.message);
          throw error;
        }
      }

      // Test 3: Verify we can write to the log stream (without sending test logs)
      try {
        console.log('[DEBUG] CloudWatch setup completed - ready to accept logs');
      } catch (error: any) {
        console.error('[ERROR] CloudWatch setup verification failed:', error.message);
        throw error;
      }

      console.log('[DEBUG] CloudWatch access test completed successfully');
    } catch (error: any) {
      console.error('[ERROR] CloudWatch access test failed:', error.message);
      console.error('[ERROR] This may indicate permission issues with AWS credentials');
      throw error;
    }
  }

  private setupLocalTransport(): void {
    // For local mode, logs are handled by:
    // 1. Console output (if enable_log_console_export is true, handled in setupTransports)
    // 2. Direct span events (handled in addSpanEventDirectly)
    // No additional transports needed for local mode
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
      attributes['log.stack_trace'] = meta?.stack_trace || getStackTrace();

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

  debug(message: string, meta?: any): void {
    // Capture stack trace at the time of the actual log call
    const stackTrace = getStackTrace();
    const logData = { ...meta, stack_trace: stackTrace };
    this.addSpanEventDirectly('debug', message, logData);
    this.logger.debug(message, logData);
    this.incrementSpanLogCount('num_debug_logs');
  }

  info(message: string, meta?: any): void {
    // Capture stack trace at the time of the actual log call
    const stackTrace = getStackTrace();
    const logData = { ...meta, stack_trace: stackTrace };
    this.addSpanEventDirectly('info', message, logData);
    this.logger.info(message, logData);
    this.incrementSpanLogCount('num_info_logs');
  }

  warn(message: string, meta?: any): void {
    // Capture stack trace at the time of the actual log call
    const stackTrace = getStackTrace();
    const logData = { ...meta, stack_trace: stackTrace };
    this.addSpanEventDirectly('warn', message, logData);
    this.logger.warn(message, logData);
    this.incrementSpanLogCount('num_warning_logs');
  }

  error(message: string, meta?: any): void {
    // Capture stack trace at the time of the actual log call
    const stackTrace = getStackTrace();
    const logData = { ...meta, stack_trace: stackTrace };
    this.addSpanEventDirectly('error', message, logData);
    this.logger.error(message, logData);
    this.incrementSpanLogCount('num_error_logs');
  }

  critical(message: string, meta?: any): void {
    // Capture stack trace at the time of the actual log call
    const stackTrace = getStackTrace();
    const logData = { ...meta, level: 'critical', stack_trace: stackTrace };
    this.addSpanEventDirectly('critical', message, logData);
    this.logger.error(message, logData);
    this.incrementSpanLogCount('num_critical_logs');
  }

  /**
   * Flush all pending log messages to their destinations
   */
  async flush(): Promise<void> {
    return new Promise(resolve => {
      console.log('[DEBUG] Flushing logger...');

      // Force a final log message to ensure all logs are processed
      this.logger.info('Final flush - ensuring all logs are sent to CloudWatch');

      // Find CloudWatch transport and flush it properly
      const cloudWatchTransports = this.logger.transports.filter(
        (transport: any) => transport.constructor.name === 'WinstonCloudWatch'
      );

      if (cloudWatchTransports.length === 0) {
        console.log('[DEBUG] No CloudWatch transports found, skipping flush');
        setTimeout(() => {
          console.log('[DEBUG] Logger flush complete');
          resolve();
        }, 1000);
        return;
      }

      console.log(`[DEBUG] Found ${cloudWatchTransports.length} CloudWatch transport(s) to flush`);

      let flushedCount = 0;
      const totalTransports = cloudWatchTransports.length;

      cloudWatchTransports.forEach((transport: any, index: number) => {
        console.log(`[DEBUG] Flushing CloudWatch transport ${index + 1}...`);

        // Try different flush methods that winston-cloudwatch-logs might support
        if (typeof transport.kthxbye === 'function') {
          console.log('[DEBUG] Using kthxbye method...');
          transport.kthxbye((error?: any) => {
            if (error) {
              console.error(`[ERROR] CloudWatch transport ${index + 1} flush error:`, error);
            } else {
              console.log(`[DEBUG] CloudWatch transport ${index + 1} flushed successfully`);
            }

            flushedCount++;
            if (flushedCount === totalTransports) {
              console.log('[DEBUG] All CloudWatch transports flushed');
              // Give a little extra time for final cleanup
              setTimeout(() => {
                console.log('[DEBUG] Logger flush complete');
                resolve();
              }, 1000);
            }
          });
        } else if (typeof transport.flush === 'function') {
          console.log('[DEBUG] Using flush method...');
          try {
            transport.flush();
            console.log(`[DEBUG] CloudWatch transport ${index + 1} flush called`);
            flushedCount++;
            if (flushedCount === totalTransports) {
              // Wait for the upload cycle to complete
              setTimeout(() => {
                console.log('[DEBUG] Logger flush complete');
                resolve();
              }, 3000); // Wait for upload cycle
            }
          } catch (error) {
            console.error(`[ERROR] CloudWatch transport ${index + 1} flush error:`, error);
            flushedCount++;
            if (flushedCount === totalTransports) {
              setTimeout(() => {
                console.log('[DEBUG] Logger flush complete');
                resolve();
              }, 1000);
            }
          }
        } else {
          console.log(
            `[DEBUG] CloudWatch transport ${index + 1} has no flush method, relying on timeout`
          );
          flushedCount++;
          if (flushedCount === totalTransports) {
            // Fallback: wait for upload cycle
            setTimeout(() => {
              console.log('[DEBUG] Logger flush complete');
              resolve();
            }, 3000); // Wait longer for upload cycle
          }
        }
      });

      // Safety timeout to prevent hanging
      setTimeout(() => {
        console.log('[DEBUG] Logger flush timeout reached, resolving anyway');
        resolve();
      }, 10000); // 10 second maximum wait
    });
  }
}

// Global logger instance
let _globalLogger: TraceRootLogger | null = null;

/**
 * Initialize the global logger instance
 */
export async function initializeLogger(config: TraceRootConfigImpl): Promise<TraceRootLogger> {
  _globalLogger = await TraceRootLogger.create(config);
  return _globalLogger;
}

/**
 * Get the global logger instance or create a new one
 */
export function get_logger(name?: string): TraceRootLogger {
  if (_globalLogger === null) {
    throw new Error('Logger not initialized. Call traceroot.init() first.');
  }

  if (name === undefined) {
    return _globalLogger;
  }

  // For named loggers, we return the global logger with a different name for now
  // This is a limitation until we make get_logger async as well
  console.warn(
    `[WARNING] Named loggers not fully supported yet. Using global logger instead of creating new one for: ${name}`
  );
  return _globalLogger;
}

/**
 * Flush all pending logs to their destinations
 */
export async function flushLogger(): Promise<void> {
  if (_globalLogger) {
    await _globalLogger.flush();
  }
}