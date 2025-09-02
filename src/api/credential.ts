import { TraceRootConfigImpl } from '../config';
import { AwsCredentials } from '../types';

/**
 * Get the TraceRoot API base URL - can be overridden via environment variable
 */
function getTraceRootApiBaseUrl(): string {
  return process.env.TRACEROOT_API_BASE_URL || 'https://api.test.traceroot.ai';
}

/**
 * Check if curl is available on the system
 */
function isCurlAvailable(): boolean {
  try {
    const { execSync } = require('child_process');
    execSync('curl --version', { stdio: 'ignore', timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch credentials using curl (existing method)
 */
function fetchWithCurl(apiUrl: string): string | null {
  try {
    const { execSync } = require('child_process');
    const curlCommand = `curl -s -H "Content-Type: application/json" "${apiUrl}"`;
    const response = execSync(curlCommand, { timeout: 5000, encoding: 'utf8' });
    return response;
  } catch {
    return null;
  }
}

/**
 * Fetch credentials using Node.js built-in modules (synchronous fallback method)
 * This uses the synchronous request approach with child_process and node
 */
function fetchWithNodeBuiltinsSync(apiUrl: string): string | null {
  try {
    const { execSync } = require('child_process');

    // Create a temporary Node.js script to make the HTTP request
    const nodeScript = `
      const url = require('url');
      const https = require('https');
      const http = require('http');

      const parsedUrl = new url.URL('${apiUrl}');
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TraceRoot-SDK-TS'
        },
        timeout: 5000
      };

      const req = client.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            // Data received successfully
          } else {
            process.exit(1);
          }
        });
      });

      req.on('error', (error) => {
        console.error('[TraceRoot] Credential fetch request failed:', error.message);
        process.exit(1);
      });

      req.on('timeout', () => {
        req.destroy();
        process.exit(1);
      });

      req.setTimeout(5000);
      req.end();
    `;

    const response = execSync(`node -e "${nodeScript.replace(/"/g, '\\"')}"`, {
      timeout: 10000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'], // Ignore stderr to prevent noise
    });

    return response.trim();
  } catch {
    return null;
  }
}

/**
 * Fetch AWS credentials from TraceRoot API (synchronous using sync HTTP)
 * It's quite complex to use an async credentials fetching for the aws credentials at least during initialization
 * because the credentials are needed for the logger to be initialized.
 *
 * This function tries multiple methods in order:
 * 1. curl (if available)
 * 2. Node.js built-in modules via child_process (fallback)
 * 3. Falls back to null if neither method works
 */
export function fetchAwsCredentialsSync(config: TraceRootConfigImpl): AwsCredentials | null {
  if (!config.token) {
    return null;
  }

  try {
    const apiUrl = `${getTraceRootApiBaseUrl()}/v1/verify/credentials?token=${encodeURIComponent(config.token)}`;

    // Try curl first (existing method)
    if (isCurlAvailable()) {
      const response = fetchWithCurl(apiUrl);
      if (response) {
        try {
          const credentials = JSON.parse(response);
          // Ensure expiration_utc is properly parsed as UTC Date
          if (credentials.expiration_utc) {
            // Force UTC parsing by ensuring the string has 'Z' suffix
            const utcString =
              typeof credentials.expiration_utc === 'string'
                ? credentials.expiration_utc.endsWith('Z')
                  ? credentials.expiration_utc
                  : credentials.expiration_utc + 'Z'
                : credentials.expiration_utc;
            credentials.expiration_utc = new Date(utcString);
          }
          return credentials;
        } catch {
          // Failed to parse JSON, try fallback
        }
      }
    }

    // Try Node.js built-in modules as fallback
    const fallbackResponse = fetchWithNodeBuiltinsSync(apiUrl);
    if (fallbackResponse) {
      try {
        const credentials = JSON.parse(fallbackResponse);
        // Ensure expiration_utc is properly parsed as UTC Date
        if (credentials.expiration_utc) {
          // Force UTC parsing by ensuring the string has 'Z' suffix
          const utcString =
            typeof credentials.expiration_utc === 'string'
              ? credentials.expiration_utc.endsWith('Z')
                ? credentials.expiration_utc
                : credentials.expiration_utc + 'Z'
              : credentials.expiration_utc;
          credentials.expiration_utc = new Date(utcString);
        }
        return credentials;
      } catch {
        // Failed to parse JSON
      }
    }
    return null;
  } catch (error: any) {
    console.error('[TraceRoot] Error in credential fetch:', error.message);
    return null;
  }
}
