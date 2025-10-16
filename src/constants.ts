/**
 * TraceRoot SDK Constants
 *
 * Shared constants used throughout the TraceRoot SDK.
 */

/**
 * Telemetry SDK language identifier for TypeScript
 */
export const TELEMETRY_SDK_LANGUAGE = 'ts';

/**
 * Telemetry attribute keys
 */
export const TELEMETRY_ATTRIBUTES = {
  SDK_LANGUAGE: 'telemetry.sdk.language',
  SDK_LANGUAGE_UNDERSCORE: 'telemetry_sdk_language',
} as const;

/**
 * TraceRoot tracer name for OpenTelemetry
 */
export const TRACER_NAME = 'traceroot';

/**
 * BatchSpanProcessor configuration constants
 */
export const BATCH_SPAN_PROCESSOR_CONFIG = {
  MAX_EXPORT_BATCH_SIZE: 5,
  EXPORT_TIMEOUT_MILLIS: 3000,
  SCHEDULED_DELAY_MILLIS: 500,
  MAX_QUEUE_SIZE: 50,
} as const;

/**
 * API endpoints
 */
export const API_ENDPOINTS = {
  VERIFY_CREDENTIALS: 'https://api.prod1.traceroot.ai/v1/verify/credentials',
} as const;
