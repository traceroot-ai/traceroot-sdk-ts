// This file configures the initialization of TraceRoot
// The config you add here will be used whenever TraceRoot is initialized
// Similar to Sentry's configuration approach

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
  token: process.env.TRACEROOT_TOKEN || 'traceroot-be9fd8e3b30c4b21baef4ea7888e599c',

  // Whether to enable console export of spans and logs
  enable_span_console_export: true,
  enable_log_console_export: true,

  // Local mode that whether to store all data locally
  local_mode: false,

  // Auto-initialize when config is loaded (default: true)
  autoInit: true,
};

export default config;
