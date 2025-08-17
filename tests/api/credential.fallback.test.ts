import { TraceRootConfigImpl } from '../../src/config';
import { fetchAwsCredentialsSync } from '../../src/api/credential';

// Mock child_process
const mockExecSync = jest.fn();
jest.mock('child_process', () => ({
  execSync: mockExecSync,
}));

describe('Credential Fetching Fallback Mechanism', () => {
  let mockConfig: TraceRootConfigImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create a mock config
    mockConfig = new TraceRootConfigImpl({
      service_name: 'test-service',
      github_owner: 'test-owner',
      github_repo_name: 'test-repo',
      github_commit_hash: 'test-commit',
      environment: 'test',
      local_mode: false,
      token: 'test-token',
    });
  });

  describe('curl availability detection', () => {
    test('should use curl when available', () => {
      // Mock curl version check to succeed (curl available)
      mockExecSync
        .mockReturnValueOnce('curl version output') // curl --version succeeds
        .mockReturnValueOnce('{"hash": "test-hash", "aws_access_key_id": "test-key"}'); // curl request succeeds

      const result = fetchAwsCredentialsSync(mockConfig);

      expect(mockExecSync).toHaveBeenCalledWith('curl --version', expect.any(Object));
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('curl -s -H "Content-Type: application/json"'),
        expect.any(Object)
      );
      expect(result).toEqual({ hash: 'test-hash', aws_access_key_id: 'test-key' });
    });

    test('should fallback to Node.js built-ins when curl is not available', () => {
      // Mock curl version check to fail (curl not available)
      mockExecSync
        .mockImplementationOnce(() => {
          throw new Error('curl not found');
        })
        // Mock the Node.js fallback to succeed
        .mockReturnValueOnce('{"hash": "fallback-hash", "aws_access_key_id": "fallback-key"}');

      const result = fetchAwsCredentialsSync(mockConfig);

      expect(mockExecSync).toHaveBeenCalledWith('curl --version', expect.any(Object));
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('node -e'),
        expect.any(Object)
      );
      expect(result).toEqual({ hash: 'fallback-hash', aws_access_key_id: 'fallback-key' });
    });

    test('should return null when both curl and fallback fail', () => {
      // Mock curl version check to fail (curl not available)
      // Mock Node.js fallback to also fail
      mockExecSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      const result = fetchAwsCredentialsSync(mockConfig);

      expect(result).toBeNull();
    });

    test('should handle invalid JSON response gracefully', () => {
      // Mock curl to be available but return invalid JSON
      mockExecSync
        .mockReturnValueOnce('curl version output') // curl --version succeeds
        .mockReturnValueOnce('invalid json response'); // curl request returns invalid JSON

      const result = fetchAwsCredentialsSync(mockConfig);

      // Should try fallback when JSON parsing fails
      expect(mockExecSync).toHaveBeenCalledTimes(3); // curl --version, curl request, node fallback
      expect(result).toBeNull(); // Should return null when all methods fail
    });

    test('should handle curl success but fallback on JSON parse error', () => {
      // Mock curl to be available but return invalid JSON, then fallback succeeds
      mockExecSync
        .mockReturnValueOnce('curl version output') // curl --version succeeds
        .mockReturnValueOnce('invalid json') // curl request returns invalid JSON
        .mockReturnValueOnce('{"hash": "fallback-hash", "aws_access_key_id": "fallback-key"}'); // fallback succeeds

      const result = fetchAwsCredentialsSync(mockConfig);

      expect(result).toEqual({ hash: 'fallback-hash', aws_access_key_id: 'fallback-key' });
    });
  });

  describe('configuration validation', () => {
    test('should return null when no token is provided', () => {
      const configWithoutToken = new TraceRootConfigImpl({
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        local_mode: false,
        // No token provided
      } as any);

      const result = fetchAwsCredentialsSync(configWithoutToken);

      expect(result).toBeNull();
      expect(mockExecSync).not.toHaveBeenCalled();
    });
  });

  describe('API URL construction', () => {
    test('should use custom API base URL from environment variable', () => {
      const originalEnv = process.env.TRACEROOT_API_BASE_URL;
      process.env.TRACEROOT_API_BASE_URL = 'https://custom.api.example.com';

      // Mock curl to be available and succeed
      mockExecSync
        .mockReturnValueOnce('curl version output')
        .mockReturnValueOnce('{"hash": "test-hash"}');

      fetchAwsCredentialsSync(mockConfig);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('https://custom.api.example.com/v1/verify/credentials'),
        expect.any(Object)
      );

      // Restore original environment
      if (originalEnv) {
        process.env.TRACEROOT_API_BASE_URL = originalEnv;
      } else {
        delete process.env.TRACEROOT_API_BASE_URL;
      }
    });

    test('should properly encode token in URL', () => {
      const configWithSpecialToken = new TraceRootConfigImpl({
        service_name: 'test-service',
        github_owner: 'test-owner',
        github_repo_name: 'test-repo',
        github_commit_hash: 'test-commit',
        environment: 'test',
        local_mode: false,
        token: 'token with spaces & special chars!',
      });

      // Mock curl to be available
      mockExecSync
        .mockReturnValueOnce('curl version output')
        .mockReturnValueOnce('{"hash": "test-hash"}');

      fetchAwsCredentialsSync(configWithSpecialToken);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('token%20with%20spaces%20%26%20special%20chars!'),
        expect.any(Object)
      );
    });
  });
});
