import { trace, context } from '@opentelemetry/api';
import { traceFunction, forceFlushTracer } from '../src/index';

async function main() {
  const tracer = trace.getTracer('autumn-test');

  async function fakeAttachFunction(): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 300));
    return 'attachment-success';
  }

  // Create manual span and set context (simulating middleware)
  const manualSpan = tracer.startSpan('POST /api/attach');

  await context.with(trace.setSpan(context.active(), manualSpan), async () => {
    // Call TraceRoot function within manual context
    const tracedFunction = traceFunction(fakeAttachFunction, { spanName: 'attachFunction' });
    const result = await tracedFunction();
    console.log('Result:', result);
  });

  // End manual span
  manualSpan.end();
}

main()
  .then(async () => {
    await forceFlushTracer();
    setTimeout(() => process.exit(0), 200);
  })
  .catch(error => {
    console.error('Test failed:', error.message);
    process.exit(1);
  });
