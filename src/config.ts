/**
 * Configuration management for TraceRoot
 */

export interface TraceRootConfig {
  // Identification
  service_name: string;

  // GitHub Identification
  github_owner: string;
  github_repo_name: string;
  github_commit_hash: string;

  // Token for TraceRoot API
  token?: string;

  // User identification
  name?: string;

  // AWS Configuration
  aws_region?: string;

  // OpenTelemetry Configuration
  otlp_endpoint?: string;

  // Environment
  environment?: string;

  // Console export
  enable_span_console_export?: boolean;
  enable_log_console_export?: boolean;

  // Cloud export
  enable_span_cloud_export?: boolean;
  enable_log_cloud_export?: boolean;

  // Local mode
  local_mode?: boolean;

  // Logging configuration (case-insensitive)
  log_level?:
    | 'debug'
    | 'info'
    | 'warn'
    | 'error'
    | 'silent'
    | 'DEBUG'
    | 'INFO'
    | 'WARN'
    | 'ERROR'
    | 'SILENT';

  // Tracer verbose logging (default: false)
  tracer_verbose?: boolean;

  // Internal properties (set during initialization)
  _name?: string;
  _sub_name?: string;
}

/**
 * Extended configuration interface for TypeScript config files
 * Allows for initialization functions and advanced configuration
 */
export interface TraceRootConfigFile extends Partial<TraceRootConfig> {
  /**
   * Optional initialization function that will be called after TraceRoot is initialized
   * This allows for custom setup logic similar to Sentry's approach
   */
  init?: (config: TraceRootConfigImpl) => Promise<void> | void;

  /**
   * Whether to automatically initialize TraceRoot when this config is loaded
   * Defaults to true
   */
  autoInit?: boolean;

  /**
   * Custom integrations or middleware to apply
   */
  integrations?: Array<any>;

  /**
   * Environment-specific configuration overrides
   */
  environments?: {
    [env: string]: Partial<TraceRootConfig>;
  };
}

export class TraceRootConfigImpl implements TraceRootConfig {
  service_name: string;
  github_owner: string;
  github_repo_name: string;
  github_commit_hash: string;
  token?: string;
  name?: string;
  aws_region: string = 'us-west-2';
  otlp_endpoint: string = 'http://localhost:4318/v1/traces';
  environment: string = 'development';
  enable_span_console_export: boolean = false;
  enable_log_console_export: boolean = true;
  enable_span_cloud_export: boolean = false;
  enable_log_cloud_export: boolean = false;
  local_mode: boolean = false;
  log_level: 'debug' | 'info' | 'warn' | 'error' | 'silent' = 'debug';
  tracer_verbose: boolean = false;
  _name?: string;
  _sub_name?: string;

  constructor(config: TraceRootConfig) {
    this.service_name = config.service_name || 'default-service';
    this.github_owner = config.github_owner || 'unknown';
    this.github_repo_name = config.github_repo_name || 'unknown';
    this.github_commit_hash = config.github_commit_hash || 'unknown';
    this.token = config.token;
    this.name = config.name;
    this.aws_region = config.aws_region || 'us-west-2';
    this.otlp_endpoint = config.otlp_endpoint || 'http://localhost:4318/v1/traces';
    this.environment = config.environment || 'development';
    this.enable_span_console_export =
      config.enable_span_console_export !== undefined
        ? config.enable_span_console_export
        : this.enable_span_console_export;
    this.enable_log_console_export =
      config.enable_log_console_export !== undefined
        ? config.enable_log_console_export
        : this.enable_log_console_export;
    this.enable_span_cloud_export =
      config.enable_span_cloud_export !== undefined
        ? config.enable_span_cloud_export
        : this.enable_span_cloud_export;
    this.enable_log_cloud_export =
      config.enable_log_cloud_export !== undefined
        ? config.enable_log_cloud_export
        : this.enable_log_cloud_export;
    this.local_mode = config.local_mode !== undefined ? config.local_mode : this.local_mode;
    this.tracer_verbose =
      config.tracer_verbose !== undefined ? config.tracer_verbose : this.tracer_verbose;
    this.log_level =
      (config.log_level?.toLowerCase() as 'debug' | 'info' | 'warn' | 'error' | 'silent') ||
      'debug';

    this._name = this.name;
    this._sub_name = `${this.service_name}-${this.environment}`;
  }
}
