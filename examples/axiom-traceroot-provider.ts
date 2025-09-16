/**
 * Example: Dual Export with Axiom + TraceRoot
 *
 * This example demonstrates how to set up dual telemetry export
 * where spans are sent to both Axiom and TraceRoot platforms.
 *
 * Setup:
 * 1. Axiom NodeSDK initializes first and creates the provider
 * 2. TraceRoot detects existing provider and enhances it
 * 3. All spans are exported to both destinations
 */

import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { trace, context } from '@opentelemetry/api';
import { registerInstrumentations } from '@opentelemetry/instrumentation';

// Step 1: Initialize Axiom NodeSDK first (matching autumn server setup exactly)
if (process.env.AXIOM_TOKEN) {
  const traceExporter = new OTLPTraceExporter({
    url: 'https://api.axiom.co/v1/traces',
    headers: {
      Authorization: `Bearer ${process.env.AXIOM_TOKEN}`,
      'X-Axiom-Dataset': 'test',
    },
  });

  // Wrap the export method to add error logging with source identification
  const originalExport = traceExporter.export.bind(traceExporter);
  traceExporter.export = function (spans, resultCallback) {
    console.log(
      `[Axiom DEBUG] Attempting to export ${spans.length} spans to Axiom endpoint: https://api.axiom.co/v1/traces`
    );

    const wrappedCallback = (result: any) => {
      if (result.code !== 0) {
        console.error(`[Axiom ERROR] Axiom export failed:`, {
          code: result.code,
          error: result.error?.message || result.error,
          endpoint: 'https://api.axiom.co/v1/traces',
          source: 'Axiom',
        });

        // Check for 403 specifically
        if (result.error?.message?.includes('403') || result.error?.toString().includes('403')) {
          console.error(
            `[Axiom ERROR] 403 Forbidden error from Axiom endpoint! Check AXIOM_TOKEN.`
          );
        }
      } else {
        console.log(`[Axiom DEBUG] Axiom export successful for ${spans.length} spans`);
      }
      resultCallback(result);
    };

    return originalExport(spans, wrappedCallback);
  };

  // Creating a resource to identify your service in traces
  const resource = new Resource({
    [ATTR_SERVICE_NAME]: 'axiom-traceroot-example',
  });

  // Configuring the OpenTelemetry Node SDK (exact autumn pattern)
  const provider = new NodeTracerProvider({
    resource: resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });

  console.log('Starting Axiom OpenTelemetry SDK');
  // Register the provider globally
  provider.register();

  // Register auto-instrumentations
  registerInstrumentations({
    instrumentations: [getNodeAutoInstrumentations()],
  });

  console.log('Axiom OpenTelemetry SDK started');

  // Verify that Axiom provider is properly registered
  const registeredProvider = trace.getTracerProvider();
  console.log('Registered provider type:', registeredProvider.constructor.name);

  if (registeredProvider.constructor.name === 'ProxyTracerProvider') {
    const delegate = (registeredProvider as any).getDelegate?.();
    console.log('ProxyTracerProvider delegate:', delegate ? delegate.constructor.name : 'null');
  }
}

// Step 2: Import TraceRoot AFTER Axiom is initialized
// Disable auto-init by setting env var BEFORE import
process.env.TRACEROOT_DISABLE_AUTO_INIT = 'true';
import * as traceroot from '../src/index';

// Step 3: Create manual tracer (following autumn pattern)
const tracer = trace.getTracer('example-app');

// Step 4: Example function to trace (similar to handleAttachment)
async function handleAttachment(attachmentId: string, userId: string): Promise<string> {
  console.log(`Processing attachment ${attachmentId} for user ${userId}`);
  // Simulate some async work
  await new Promise(resolve => setTimeout(resolve, 100));
  // Simulate some processing logic
  const result = `Processed attachment ${attachmentId}`;
  console.log(`Result: ${result}`);

  return result;
}

// Step 5: Wrap the function with TraceRoot tracing
const tracedHandleAttachment = traceroot.traceFunction(handleAttachment, {
  spanName: 'handleAttachment',
  traceParams: true,
  traceReturnValue: true,
});

// Step 6: Main example function following autumn's request pattern
async function runExample() {
  // Generate request context (similar to autumn's middleware)
  const requestId = `req_${Date.now()}`;
  const timestamp = Date.now();

  console.log(`Starting request ${requestId}`);

  // Create main request span (similar to autumn's index.ts:104)
  const spanName = `GET /attachments/process - ${requestId}`;
  const span = tracer.startSpan(spanName);

  span.setAttributes({
    req_id: requestId,
    method: 'GET',
    url: '/attachments/process',
    timestamp: timestamp,
  });

  // Function to end span (similar to autumn's endSpan function)
  const endSpan = () => {
    try {
      span.setAttributes({
        'http.response.status_code': 200,
        'http.response.duration': Date.now() - timestamp,
      });
      span.end();

      // Create additional close span (following autumn pattern)
      const closeSpan = tracer.startSpan('response_closed');
      closeSpan.setAttributes({
        req_id: requestId,
      });
      closeSpan.end();

      console.log(`Request ${requestId} completed`);
    } catch (error) {
      console.error('Error ending span', error);
    }
  };

  try {
    // Run the traced function within the span's context (autumn pattern)
    const result = await context.with(trace.setSpan(context.active(), span), async () => {
      return await tracedHandleAttachment('attach_123', 'user_456');
    });
    console.log(`Function result: ${result}`);
    // Set success status
    span.setStatus({ code: 1 }); // OK status
  } catch (error: any) {
    console.error('Error in request:', error);
    // Record error on span
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message }); // ERROR status
  } finally {
    // Always end the span
    endSpan();
  }
}

// Step 7: Run the example and cleanup
async function main() {
  console.log('Dual Export Example: Axiom + TraceRoot');
  // Run multiple example requests
  for (let i = 1; i <= 3; i++) {
    await runExample();

    // Wait between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  // Force flush to ensure all spans are exported
  await traceroot.forceFlushTracer();

  // Wait for 5 seconds to ensure all spans are exported
  await new Promise(resolve => setTimeout(resolve, 5000));
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await traceroot.forceFlushTracer();
  await traceroot.shutdownTracer();
  process.exit(0);
});

// Function to check if Axiom delegate is ready
function waitForAxiomDelegate(callback: () => void, maxAttempts = 10) {
  const registeredProvider = trace.getTracerProvider();

  if (registeredProvider.constructor.name === 'ProxyTracerProvider') {
    const delegate = (registeredProvider as any).getDelegate?.();

    if (delegate && delegate.constructor.name !== 'NoopTracerProvider') {
      console.log(`Axiom delegate is ready: ${delegate.constructor.name}`);
      callback();
      return;
    }
  }

  if (maxAttempts > 0) {
    console.log(`Waiting for Axiom delegate... (${10 - maxAttempts + 1}/10)`);
    setTimeout(() => waitForAxiomDelegate(callback, maxAttempts - 1), 200);
  } else {
    console.log('Axiom delegate not ready after waiting, proceeding anyway...');
    callback();
  }
}

// Wait for Axiom provider to be fully registered, then init TraceRoot and run
waitForAxiomDelegate(() => {
  console.log('Manually initializing TraceRoot...');
  // Initialize with basic config since we disabled auto-init
  traceroot.init({
    service_name: 'axiom-traceroot-example',
    token: process.env.TRACEROOT_TOKEN || 'traceroot-*',
    enable_span_console_export: true,
    enable_span_cloud_export: true,
  });

  // Run the example after TraceRoot is initialized
  setTimeout(() => {
    main().catch(console.error);
  }, 100);
});
