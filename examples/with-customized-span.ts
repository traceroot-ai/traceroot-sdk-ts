import { trace, context } from '@opentelemetry/api';
import { BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import {
  traceFunction,
  forceFlushTracer,
  forceFlushLogger,
  getLogger,
  getTracerProvider,
} from '../src/index';

const tracer = trace.getTracer('customized-span');
const logger = getLogger('customized-span');

async function main() {
  // Get TraceRoot's provider and add Axiom processor
  const traceRootProvider = getTracerProvider();

  if (traceRootProvider) {
    // Simulate Axiom export by appending to the provider's processor list
    const axiomProcessor = new BatchSpanProcessor(new ConsoleSpanExporter());
    // Access the internal _registeredSpanProcessors array and append
    if ((traceRootProvider as any)._registeredSpanProcessors) {
      (traceRootProvider as any)._registeredSpanProcessors.push(axiomProcessor);
      console.log('Appended Axiom processor to TraceRoot provider');
    }
  }

  async function fakeAttachFunction(requestId: string): Promise<string> {
    logger.info({ requestId }, 'Starting attach operation');
    await new Promise(resolve => setTimeout(resolve, 300));
    logger.info({ requestId }, 'Completed attach operation');
    return 'attachment-success';
  }

  // Create TraceRoot wrapper (following autumn pattern)
  const tracedAttachFunction = traceFunction(fakeAttachFunction, {
    spanName: 'attachFunction',
  });

  // Create manual span and set context (simulating middleware)
  const manualSpan = tracer.startSpan('POST /api/attach');

  await context.with(trace.setSpan(context.active(), manualSpan), async () => {
    // Call TraceRoot wrapped function within manual context
    const result = await tracedAttachFunction('req-123');
    console.log('Result:', result);
  });

  // End manual span
  manualSpan.end();
}

main()
  .then(async () => {
    await forceFlushTracer();
    await forceFlushLogger();
    setTimeout(() => process.exit(0), 200);
  })
  .catch(error => {
    console.error('Test failed:', error.message);
    process.exit(1);
  });
