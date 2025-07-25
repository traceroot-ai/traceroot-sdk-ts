# TraceRoot SDK for TypeScript

A TypeScript SDK for TraceRoot tracing and logging, providing the same functionality as the Python version with OpenTelemetry tracing and Winston logging.

```bash
npm install
npm run build
npm run format
npm run lint
npx ts-node --transpile-only examples/simple-example.ts
```

## Features

- **OpenTelemetry Integration**: Automatic distributed tracing with OpenTelemetry
- **AWS CloudWatch Logging**: Seamless integration with AWS CloudWatch for production logging
- **Local Development Mode**: Local logging and tracing for development
- **Trace Correlation**: Automatic correlation between traces and logs
- **TypeScript Support**: Full TypeScript support with type definitions
- **Decorator Support**: Method decorators for easy tracing (experimental)

## Installation

```bash
npm install traceroot-sdk-ts
# or
yarn add traceroot-sdk-ts
```

## Quick Start

### 1. Initialize the SDK

```typescript
import * as traceroot from 'traceroot-sdk-ts';

// Configuration
const config: Partial<traceroot.TraceRootConfig> = {
  service_name: 'my-service',
  github_owner: 'my-org',
  github_repo_name: 'my-repo',
  github_commit_hash: 'abc123',
  environment: 'development',
  
  // For local development
  local_mode: true,
  enable_span_console_export: true,
  enable_log_console_export: true,
  
  // For AWS production (requires token)
  // local_mode: false,
  // token: 'your-traceroot-token',
  // aws_region: 'us-west-2',
};

// Initialize
traceroot.init(config);
```

### 2. Get a Logger

```typescript
const logger = traceroot.get_logger();

// Use the logger
logger.info('Application started');
logger.debug('Debug information', { userId: 123 });
logger.error('Something went wrong', { error: 'Details' });
```

### 3. Manual Tracing (Recommended)

```typescript
// For manual tracing, use the tracer directly
import { trace as otelTrace } from '@opentelemetry/api';

const tracer = otelTrace.getTracer('my-app');

async function processData(data: string): Promise<string> {
  return tracer.startActiveSpan('processData', async (span) => {
    try {
      logger.info('Processing data', { data });
      
      // Your business logic here
      await someAsyncOperation();
      
      const result = `Processed: ${data}`;
      span.setAttribute('result', result);
      logger.info('Data processed successfully', { result });
      
      return result;
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### 4. Decorator Support (Experimental)

**Note**: TypeScript decorators have some limitations. Manual tracing is recommended for production use.

```typescript
class MyService {
  @traceroot.trace({ 
    traceParams: true, 
    traceReturnValue: true 
  })
  async processData(data: string, count: number): Promise<string> {
    logger.info('Processing data', { data, count });
    // Your logic here
    return `Processed: ${data}`;
  }
}
```

## Configuration Options

```typescript
interface TraceRootConfig {
  // Required
  service_name: string;
  github_owner: string;
  github_repo_name: string;
  github_commit_hash: string;
  
  // Optional
  token?: string;                      // TraceRoot API token
  name?: string;                       // User identification
  aws_region?: string;                 // AWS region (default: us-west-2)
  otlp_endpoint?: string;              // OTLP endpoint
  environment?: string;                // Environment (default: development)
  enable_span_console_export?: boolean; // Console span export
  enable_log_console_export?: boolean;  // Console log export
  local_mode?: boolean;                // Local development mode
}
```

## Development Setup

1. **Clone and Install**:
   ```bash
   git clone <repository>
   cd traceroot-sdk-ts
   npm install
   ```

2. **Build**:
   ```bash
   npm run build
   ```

3. **Run Example**:
   ```bash
   npm run example
   # or for the simple example
   npx ts-node examples/simple-example.ts
   ```

## Local vs AWS Mode

### Local Mode (`local_mode: true`)
- Logs are written to console and added as span events
- Traces are exported to the configured OTLP endpoint
- No AWS credentials required
- Perfect for development

### AWS Mode (`local_mode: false`)
- Logs are sent to AWS CloudWatch
- Traces are sent to AWS X-Ray via the TraceRoot service
- Requires a valid TraceRoot token
- Automatic AWS credential management

## Examples

### Simple Function Tracing

```typescript
import * as traceroot from 'traceroot-sdk-ts';

traceroot.init({
  service_name: 'my-app',
  github_owner: 'my-org',
  github_repo_name: 'my-repo',  
  github_commit_hash: 'abc123',
  local_mode: true,
});

const logger = traceroot.get_logger();

async function main() {
  logger.info('Application started');
  
  // Your application logic
  const result = await processUserData('user123');
  
  logger.info('Application completed', { result });
}

async function processUserData(userId: string): Promise<string> {
  logger.info('Processing user data', { userId });
  
  // Simulate work
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return `Processed data for ${userId}`;
}

main().catch(console.error);
```

### Multiple Loggers

```typescript
// Get different loggers for different components
const mainLogger = traceroot.get_logger();
const dbLogger = traceroot.get_logger('database');
const apiLogger = traceroot.get_logger('api');

mainLogger.info('Main application logic');
dbLogger.info('Database operation completed');
apiLogger.info('API request processed');
```

## Configuration File

You can also use a `.traceroot-config.yaml` file:

```yaml
service_name: my-service
github_owner: my-org
github_repo_name: my-repo
github_commit_hash: abc123def456
environment: development
local_mode: true
enable_span_console_export: true
enable_log_console_export: true
```

The SDK will automatically search for this file in the current directory and parent directories.

## API Reference

### Functions

- `init(config?)`: Initialize the SDK
- `get_logger(name?)`: Get a logger instance
- `trace(options?)`: Decorator for function tracing (experimental)

### Types

- `TraceRootConfig`: Configuration interface
- `TraceOptions`: Tracing options interface
- `TraceRootLogger`: Logger class

## Troubleshooting

### Common Issues

1. **Import Errors**: Make sure all dependencies are installed (`npm install`)
2. **Decorator Issues**: TypeScript decorators require `experimentalDecorators: true` in tsconfig.json
3. **AWS Credentials**: Ensure your TraceRoot token is valid for AWS mode
4. **OTLP Endpoint**: Check that your OTLP collector is running and accessible

### Debug Logging

Enable debug logging to troubleshoot issues:

```typescript
traceroot.init({
  // ... your config
  enable_log_console_export: true,
  enable_span_console_export: true,
});

const logger = traceroot.get_logger();
logger.debug('Debug message to help troubleshoot');
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details. 