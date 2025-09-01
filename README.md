# TraceRoot TypeScript SDK

<div align="center">
  <a href="https://traceroot.ai/">
    <img src="https://raw.githubusercontent.com/traceroot-ai/traceroot/main/misc/images/traceroot_logo.png" alt="TraceRoot Logo">
  </a>
</div>

<div align="center">

[![Testing Status][testing-image]][testing-url]
[![Documentation][docs-image]][docs-url]
[![npm version][npm-image]][npm-url]
[![TraceRoot.AI Website][company-website-image]][company-website-url]

</div>

Please see [TypeScript SDK Docs](https://docs.traceroot.ai/sdk/typescript) for details

## Introduction

This SDK allows you to trace functions and utilizes TraceRoot's own logger within the TraceRoot trace. It captures all the context designed for advanced debugging of AI agents.

### OpenTelemetry

The trace is built upon OpenTelemetry, and the traces will be sent to TraceRoot's own endpoint.

### Winston

The logger is based on Winston, designed for integration with CloudWatch. And currently the logs will be stored in AWS.

## Installation

```bash
npm install traceroot-sdk-ts@latest
```

## Configuration

At first you need to create a `traceroot.config.ts` file in the root of your project:

```typescript
import type { TraceRootConfigFile } from 'traceroot-sdk-ts/src/config';

const config: TraceRootConfigFile = {
  // Basic service configuration
  service_name: 'ts-example',
  github_owner: 'traceroot-ai',
  github_repo_name: 'traceroot-sdk-ts',
  github_commit_hash: 'main',

  // Your environment configuration such as development, staging, production
  environment: 'development',

  // Token configuration
  // This is the token you can generate from the TraceRoot.AI website
  token: 'traceroot-***********************',

  // Whether to enable console export of spans and logs
  enable_span_console_export: false,
  enable_log_console_export: true,

  // Local mode that whether to store all data locally
  local_mode: false,
};
export default config;
```

An example is shown in the [traceroot.config.ts](./traceroot.config.ts) file.

If you don't have TypeScript node and runtime installed, you can also use JavaScript config:

```javascript
const config = {
    // Basic service configuration
    service_name: 'js-example',
    github_owner: 'traceroot-ai',
    github_repo_name: 'traceroot-sdk',
    github_commit_hash: 'main',

    // Your environment configuration
    // development, staging, production
    environment: 'development',

    // Token configuration
    token: 'traceroot-*',

    // Whether to enable console export of spans and logs
    enable_span_console_export: false,
    enable_log_console_export: true,

    // Local mode that whether to store all data locally
    local_mode: false,
  };

  module.exports = config;
```

An example is shown in the [traceroot.config.js](./traceroot.config.js) file.

### Indicate the Location of the Config File

Sometimes it's quite hard to find the config file in the project root due to webpack or other bundlers. You can set the `TRACEROOT_CONFIG_PATH` environment variable to indicate the location of the config file.

```bash
export TRACEROOT_CONFIG_PATH=/path/to/your/traceroot.config.ts
```

### Cloud and Console Export

You can enable the cloud export of spans and logs by setting the `enable_span_cloud_export` and `enable_log_cloud_export` to `true`. By default, all those are set to `true`. If you set `enable_span_cloud_export` to `false`, the cloud export of spans will be disabled (it will also disable the cloud export of logs). If you set `enable_log_cloud_export` to `false`, only the cloud export of logs will be disabled.

You can enable the console export of spans and logs by setting the `enable_span_console_export` and `enable_log_console_export` to `true`. Enable them will print out spans or logs in the console.

## Usage

Then you can use the `traceroot.traceFunction` to trace your functions:

```typescript
import * as traceroot from 'traceroot-sdk-ts';

const logger = traceroot.getLogger();

async function main() {
  const greet = traceroot.traceFunction(
    async function greet(name: string): Promise<string> {
      logger.info(`Greeting inside traced function: ${name}`);
      // Simulate some async work
      await new Promise(resolve => setTimeout(resolve, 100));
      return `Hello, ${name}!`;
    },
    { spanName: 'greet' }
  );

  const result = await greet('world');
  logger.info(`Greeting result: ${result}`);
}

main().then(async () => {
  await traceroot.forceFlushTracer();
  await traceroot.shutdownTracing();
  await traceroot.forceFlushLogger();
  await traceroot.shutdownLogger();
  process.exit(0);
});
```

Or just use the decorator such as:

```typescript
import * as traceroot from 'traceroot-sdk-ts';

const logger = traceroot.getLogger();

class GreetingService {
  // @ts-ignore - TypeScript has strict typing issues with decorators, but this works at runtime
  @traceroot.trace({ spanName: 'greet' })
  async greet(name: string): Promise<string> {
    logger.info(`Greeting inside traced function: ${name}`);
    // Simulate some async work
    await new Promise(resolve => setTimeout(resolve, 1000));
    return `Hello, ${name}!`;
  }
}

async function main() {
  const service = new GreetingService();
  const result = await service.greet('world');
  logger.info(`Greeting result: ${result}`); // This will not be shown in TraceRoot UI
}

main().then(async () => {
  await traceroot.forceFlushTracer();
  await traceroot.shutdownTracing();
  await traceroot.forceFlushLogger();
  await traceroot.shutdownLogger();
  process.exit(0);
});
```

### Logging with Metadata

You can also log with some metadata and make it searchable in the TraceRoot UI via:

```typescript
logger.info({ requestId, userId }, `Making another request`);
// or
logger.info({ userId }, `Making another request`, { requestId });
```

If you choose to log with metadata, you can search for it in the TraceRoot UI. Here is an example:

```typescript
import * as traceroot from 'traceroot-sdk-ts';

const logger = traceroot.getLogger();

async function main() {
  const makeRequest = traceroot.traceFunction(
    async function makeRequest(requestId: string, userId: string): Promise<string> {
      // This will store the userId as a metadata attribute in the span so you can search for it in the TraceRoot UI
      logger.info({ userId }, `Making request: ${requestId}`);
      logger.debug('Pure debug message');
      await makeAnotherRequest(requestId, userId);
      // Simulate some async work
      await new Promise(resolve => setTimeout(resolve, 1000));
      return `Request ${requestId} completed`;
    },
    { spanName: 'makeRequest', traceParams: true }
  );
  const result = await makeRequest('123', 'user123');
  logger.info(`Request result: ${result}`); // This will not be shown in TraceRoot UI
}

async function makeAnotherRequest(requestId: string, userId: string) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  // This will store the requestId and userId as a metadata attribute in the span so you can search for it in the TraceRoot UI
  logger.info({ userId, requestId }, `Making another request`);
}

main().then(async () => {
  await traceroot.forceFlushTracer();
  await traceroot.shutdownTracing();
  await traceroot.forceFlushLogger();
  await traceroot.shutdownLogger();
  process.exit(0);
});

```

More details can be found in the [examples](./examples).

You can run following examples after modifying the `traceroot.config.ts` file:

```bash
npx ts-node --transpile-only examples/simple-example-sync.ts # Not working for now
npx ts-node --transpile-only examples/simple-example.ts
npx ts-node --transpile-only examples/simple-example-decorator.ts
npx ts-node --transpile-only examples/example.ts
npx ts-node --transpile-only examples/example-decorator.ts
npx ts-node --transpile-only examples/child-logger-example.ts
npx ts-node --transpile-only examples/log-level-example.ts
```

## Development

```bash
npm install
npm run build
npm run format
npm run lint --fix
npx prettier --write src tests examples
npx prettier --write [JS-CONFIG-FILE]
npm run test # Run tests
npm test -- tests/logger/logger.pathProcessing.test.ts # Run a specific test
```

### Publish to npm

```bash
npm login
npm run build
npm pack --dry-run

# Alpha (for testing)
# For next alpha version
npm version prerelease --preid=alpha  # 0.0.1-alpha.1
npm publish --tag alpha
npm dist-tag ls traceroot-sdk-ts
# Add the latest version to the latest tag
npm dist-tag add traceroot-sdk-ts@0.0.1-alpha.[version] latest

npm view traceroot-sdk-ts

# Install the alpha version
npm install traceroot-sdk-ts@alpha
```

## Contact Us

Please reach out to founders@traceroot.ai if you have any questions.

[company-website-image]: https://img.shields.io/badge/website-traceroot.ai-148740
[company-website-url]: https://traceroot.ai
[docs-image]: https://img.shields.io/badge/docs-traceroot.ai-0dbf43
[docs-url]: https://docs.traceroot.ai
[npm-image]: https://img.shields.io/npm/v/traceroot-sdk-ts?style=flat-square&logo=npm&logoColor=fff
[npm-url]: https://www.npmjs.com/package/traceroot-sdk-ts
[testing-image]: https://github.com/traceroot-ai/traceroot/actions/workflows/test.yml/badge.svg
[testing-url]: https://github.com/traceroot-ai/traceroot/actions/workflows/test.yml
