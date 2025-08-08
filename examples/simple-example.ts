import * as traceroot from '../src/index';

const logger = traceroot.get_logger();

async function main() {
  const greet = traceroot.traceFunction(
    async function greet(name: string): Promise<string> {
      logger.info(`Greeting inside traced function: ${name}`);
      // Simulate some async work
      await new Promise(resolve => setTimeout(resolve, 1000));
      return `Hello, ${name}!`;
    },
    { spanName: 'greet' }
  );

  const result = await greet('world');
  logger.info(`Greeting result: ${result}`); // This will not be shown in TraceRoot UI
}

main().then(async () => {
  await traceroot.forceFlushTracer();
  await traceroot.shutdownTracing();
  await traceroot.forceFlushLogger();
  await traceroot.shutdownLogger();
  process.exit(0);
});
