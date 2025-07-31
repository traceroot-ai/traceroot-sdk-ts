import * as traceroot from '../src/index';
import { forceFlush, shutdownTracing } from '../src/tracer';

// Main example function that handles initialization and execution
async function main() {
  // Initialize TraceRoot
  await traceroot.init();

  // Get a logger instance
  const logger = traceroot.get_logger();

  // Example using traceFunction wrapper for async function
  const processData = traceroot.traceFunction(
    async function processData(data: string, count: number): Promise<string> {
      // Simulate some work
      await delay(100);

      const result = `Processed: ${data} (${count} times)`;
      logger.info('✅ Async processing result in processData', { result });

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
      logger.info('🔢 Starting sum calculation in calculateSum', { inputNumbers: numbers });
      const sum = numbers.reduce((acc, num) => {
        return acc + num;
      }, 0);
      logger.info('✅ Sum calculation completed in calculateSum', { result: sum });
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
        logger.error('✅ Caught expected error in simulateError', _error.message);
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
        logger.info('🚀 Starting example');
        // Example 1: Async function with tracing and parameter tracking
        const result1 = await processData('test-data', 5);
        logger.info('✅ Processed data in runExample', { result: result1 });

        // Example 2: Sync function with tracing and return value tracking
        const numbers = [1, 2, 3, 4, 5];
        const sum = calculateSum(numbers);
        logger.info('✅ Sum calculation completed in runExample', { result: sum });

        // Example 3: Error handling with tracing
        try {
          await simulateError();
        } catch {
          // Error already logged inside simulateError
        }

        // Example 4: Call API endpoint with proper tracing context propagation
        try {
          logger.info('📡 Making API call to /calculate endpoint');

          // Get trace headers to propagate current trace context
          const traceHeaders = traceroot.getTraceHeaders();

          // Get detailed span information for debugging
          const spanInfo = traceroot.getActiveSpanInfo();

          let message = `
          spanInfo: ${JSON.stringify(spanInfo)}
          traceHeaders: ${JSON.stringify(traceHeaders)}
          headerCount: ${Object.keys(traceHeaders).length}
          `;

          logger.debug('🔗 Trace Context Debug: ' + message);

          const response = await fetch('http://localhost:9999/calculate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...traceHeaders, // Spread trace headers to maintain trace correlation
            },
            body: JSON.stringify([1, 2, 3, 4, 5]),
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const result = await response.json();

          const spanInfo2 = traceroot.getActiveSpanInfo();
          let message2 = `
          spanInfo2: ${JSON.stringify(spanInfo2)}
          traceHeaders2: ${JSON.stringify(traceHeaders)}
          headerCount2: ${Object.keys(traceHeaders).length}
          `;

          logger.debug('🔗 Trace Context Debug: ' + message2);

          logger.info('✅ API call completed', { response: result });
        } catch (error: any) {
          logger.error('❌ API call failed', { error: error.message });
        }
      } catch (error: any) {
        logger.error('❌ Example failed', { error: error.message });
      }
    },
    {
      spanName: 'run_example_orchestrator',
      traceReturnValue: false, // No return value to trace for void function
    }
  );

  // Run the example
  await runExample();
}

// Execute the main function
main()
  .then(async () => {
    await traceroot.flushLogger();
    await forceFlush();
    await shutdownTracing();
    process.exit(0);
  })
  .catch(async error => {
    console.error('\n❌ Example failed:', error);
    await traceroot.flushLogger();
    process.exit(1);
  });
