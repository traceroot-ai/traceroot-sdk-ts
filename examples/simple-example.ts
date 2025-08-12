import * as traceroot from '../src/index';

const logger = traceroot.get_logger();

async function main() {
  const makeRequest = traceroot.traceFunction(
    async function makeRequest(requestId: string): Promise<string> {
      logger.info(`Making request: ${requestId}`);
      await makeAnotherRequest(requestId);
      // Simulate some async work
      await new Promise(resolve => setTimeout(resolve, 1000));
      return `Request ${requestId} completed`;
    },
    { spanName: 'makeRequest', traceParams: true }
  );
  const result = await makeRequest('123');
  logger.info(`Request result: ${result}`); // This will not be shown in TraceRoot UI
}

async function makeAnotherRequest(requestId: string) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  // This will store the requestId as a metadata attribute in the span so you can search for it in the TraceRoot UI
  logger.info({ requestId }, `Making another request`);
}

main().then(async () => {
  await traceroot.forceFlushTracer();
  await traceroot.shutdownTracing();
  await traceroot.forceFlushLogger();
  await traceroot.shutdownLogger();
  process.exit(0);
});
