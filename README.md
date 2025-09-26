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
[![TraceRoot.AI Website](https://raw.githubusercontent.com/traceroot-ai/traceroot/refs/heads/main/misc/images/custom-website-badge.svg)][company-website-url]

</div>

Please see [TypeScript SDK Docs](https://docs.traceroot.ai/sdk/typescript) for details

## Installation

```bash
npm install traceroot-sdk-ts@latest
```

## Examples

```typescript
import * as traceroot from 'traceroot-sdk-ts';

const logger = traceroot.get_logger();

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

## Contact Us

Please reach out to founders@traceroot.ai if you have any questions.

[company-website-url]: https://traceroot.ai
[docs-image]: https://img.shields.io/badge/docs-traceroot.ai-0dbf43
[docs-url]: https://docs.traceroot.ai
[npm-image]: https://img.shields.io/npm/v/traceroot-sdk-ts?style=flat-square&logo=npm&logoColor=fff
[npm-url]: https://www.npmjs.com/package/traceroot-sdk-ts
[testing-image]: https://github.com/traceroot-ai/traceroot-sdk-ts/actions/workflows/test.yml/badge.svg
[testing-url]: https://github.com/traceroot-ai/traceroot-sdk-ts/actions/workflows/test.yml
