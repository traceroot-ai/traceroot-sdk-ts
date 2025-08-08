const config = {
    // Basic service configuration
    service_name: 'js-example',
    github_owner: 'traceroot-ai',
    github_repo_name: 'traceroot-sdk',
    github_commit_hash: 'main',
  
    // Your environment configuration
    // development, staging, production
    environment: 'development',
  
    // Token configuration
    token: 'traceroot-*',
  
    // Whether to enable console export of spans and logs
    enable_span_console_export: false,
    enable_log_console_export: true,
  
    // Local mode that whether to store all data locally
    local_mode: false,
  };
  
  module.exports = config;
  