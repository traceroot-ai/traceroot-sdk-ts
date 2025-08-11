import { TraceRootConfigImpl } from '../config';
import { AwsCredentials } from '../types';

// TraceRoot API base URL - can be overridden via environment variable
const TRACEROOT_API_BASE_URL =
  process.env.TRACEROOT_API_BASE_URL || 'https://api.test.traceroot.ai';

/**
 * Fetch AWS credentials from TraceRoot API (synchronous using sync HTTP)
 * It's quite complex to use an async credentials fetching for the aws credentials at least during initialization
 * because the credentials are needed for the logger to be initialized.
 */
export function fetchAwsCredentialsSync(config: TraceRootConfigImpl): AwsCredentials | null {
  if (!config.token) {
    console.log('[TraceRoot] No token provided, skipping AWS credentials fetch');
    return null;
  }

  try {
    const apiUrl = `${TRACEROOT_API_BASE_URL}/v1/verify/credentials?token=${encodeURIComponent(config.token)}`;

    // Create a synchronous HTTP request using child_process
    const { execSync } = require('child_process');

    try {
      const curlCommand = `curl -s -H "Content-Type: application/json" "${apiUrl}"`;
      const response = execSync(curlCommand, { timeout: 5000, encoding: 'utf8' });
      const credentials = JSON.parse(response);
      return credentials;
    } catch (error: any) {
      void error;
      return null;
    }
  } catch (error: any) {
    void error;
    return null;
  }
}
