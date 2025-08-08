import * as traceroot from '../src/index';
import { forceFlushTracerSync, shutdownTracingSync } from '../src/tracer';
import { forceFlushLoggerSync, shutdownLoggerSync } from '../src/logger';

const greet = traceroot.traceFunction(
  function greet(name: string): string {
    const logger = traceroot.get_logger();
    logger.info(`Greeting inside traced function: ${name}`);
    return `Hello, ${name}!`;
  },
  { spanName: 'greet' }
);

greet('world');

// Shutdown the tracer and logger
forceFlushTracerSync();
forceFlushLoggerSync();
shutdownTracingSync();
shutdownLoggerSync();
