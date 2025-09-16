import type { TraceRootConfigFile } from './src/config';

const config: TraceRootConfigFile = {
  // Basic service configuration
  service_name: 'ts-example',
  github_owner: 'traceroot-ai',
  github_repo_name: 'traceroot-sdk-ts',
  github_commit_hash: 'main',

  // Your environment configuration
  // development, staging, production
  environment: process.env.NODE_ENV || 'development',

  // Token configuration
  token: 'traceroot-2482242f32984b318ab19c3ed6cf73bc',

  // Whether to enable console export of spans and logs
  enable_span_console_export: true,
  enable_log_console_export: true,

  // Whether to enable cloud export of spans and logs
  enable_span_cloud_export: true,
  enable_log_cloud_export: true,

  // Log level
  log_level: 'debug',

  // Local mode that whether to store all data locally
  local_mode: false,
};

export default config;
