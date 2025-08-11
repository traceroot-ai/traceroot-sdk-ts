/**
 * Shared type definitions for the TraceRoot SDK
 */

/**
 * Configuration options for tracing functions and methods
 */
export interface TraceOptions {
  /** Span name (function name) */
  spanName?: string;
  /** Suffix to append to the function name for span naming */
  spanNameSuffix?: string;
  /** Whether to trace function parameters (true for all, array for specific params) */
  traceParams?: boolean | string[];
  /** Whether to trace the return value */
  traceReturnValue?: boolean;
  /** Whether to flatten nested objects in attributes */
  flattenAttributes?: boolean;
}

/**
 * AWS credentials structure returned from TraceRoot API
 */
export interface AwsCredentials {
  /** AWS access key ID */
  aws_access_key_id: string;
  /** AWS secret access key */
  aws_secret_access_key: string;
  /** AWS session token */
  aws_session_token: string;
  /** AWS region */
  region: string;
  /** User hash identifier */
  hash: string;
  /** Credential expiration time */
  expiration_utc: Date;
  /** OTLP endpoint URL */
  otlp_endpoint: string;
}
