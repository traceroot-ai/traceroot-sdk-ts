import * as traceroot from '../src/index';
import { forceFlush, shutdownTracing } from '../src/tracer';
import { trace as otelTrace } from '@opentelemetry/api';

// Configuration for the example
const config: Partial<traceroot.TraceRootConfig> = {
  service_name: 'js-example',
  github_owner: 'your-org',
  github_repo_name: 'your-repo',
  github_commit_hash: 'abc123def456',
  environment: 'development',

  // For local testing, set to true
  local_mode: true,
  enable_span_console_export: true,
  enable_log_console_export: true,

  // For AWS mode, uncomment these:
  // local_mode: false,
  // token: 'your-traceroot-token-here',
  // aws_region: 'us-west-2',
};

// Initialize TraceRoot
traceroot.init(config);

// Get a logger instance
const logger = traceroot.get_logger();

// Example using traceFunction wrapper for async function
const processData = traceroot.traceFunction(
  async function processData(data: string, count: number): Promise<string> {
    // Simulate some work
    await delay(100);

    // ADD DEBUG LINE TO CHECK SPAN RECORDING STATE:
    const span = otelTrace.getActiveSpan();
    console.log(`[DEBUG] Before logger call - span recording: ${span?.isRecording()}`);

    const result = `Processed: ${data} (${count} times)`;
    logger.info('✅ Async processing result', { result });

    return result;
  },
  {
    traceParams: true,
    traceReturnValue: true,
  }
);

// Example using traceFunction wrapper with custom span name
const delay = traceroot.traceFunction(
  async function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
  {
    spanName: 'delay_execution',
    traceParams: true,
  }
);

// Example using traceFunction wrapper for sync function
const calculateSum = traceroot.traceFunction(
  function calculateSum(numbers: number[]): number {
    logger.info('🔢 Starting sum calculation', { inputNumbers: numbers });
    const sum = numbers.reduce((acc, num) => {
      return acc + num;
    }, 0);
    logger.info('✅ Sum calculation completed', { result: sum });
    return sum;
  },
  {
    traceParams: true,
    traceReturnValue: true,
  }
);

// Example with error tracing
const simulateError = traceroot.traceFunction(
  async function simulateError(): Promise<void> {
    try {
      throw new Error('This is a simulated error for testing');
    } catch (_error: any) {
      logger.error('✅ Caught expected error', _error.message);
    }
  },
  {
    spanName: 'error_simulation',
  }
);

// Example of the main orchestrator function with tracing
const runExample = traceroot.traceFunction(
  async function runExample(): Promise<void> {
    try {
      // Example 1: Async function with tracing and parameter tracking
      const result1 = await processData('test-data', 5);
      logger.info('✅ Processed data', { result: result1 });

      // Example 2: Sync function with tracing and return value tracking
      const numbers = [1, 2, 3, 4, 5];
      const sum = calculateSum(numbers);
      logger.info('✅ Sum calculation completed', { result: sum });

      // Add a small delay to ensure calculateSum span is processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Example 3: Error handling with tracing
      try {
        await simulateError();
      } catch {
        // Error already logged inside simulateError
      }

      // Add a small delay to ensure error_simulation span is processed
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error: any) {
      logger.error('❌ Example failed', { error: error.message });
      throw error;
    }
  },
  {
    spanName: 'run_example_orchestrator',
    traceReturnValue: false, // No return value to trace for void function
  }
);

// Run the example
runExample()
  .then(async () => {
    await forceFlush();
    await shutdownTracing();
    process.exit(0);
  })
  .catch(async error => {
    console.error('\n❌ Example failed:', error);
    process.exit(1);
  });
