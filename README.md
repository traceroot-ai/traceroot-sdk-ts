<div align="center">

[![Testing Status][testing-image]][testing-url]
[![Documentation][docs-image]][docs-url]
[![Discord][discord-image]][discord-url]
[![PyPI Version][pypi-image]][pypi-url]
[![PyPI SDK Downloads][pypi-sdk-downloads-image]][pypi-sdk-downloads-url]
[![npm version][npm-image]][npm-url]
[![TraceRoot.AI Website][company-website-image]][company-website-url]
[![X][company-x-image]][company-x-url]
[![X][zecheng-x-image]][zecheng-x-url]
[![X][xinwei-x-image]][xinwei-x-url]
[![LinkedIn][company-linkedin-image]][company-linkedin-url]
[![WhatsApp][company-whatsapp-image]][company-whatsapp-url]
[![Wechat][wechat-image]][wechat-url]

</div>

# TraceRoot SDK for TypeScript

A TypeScript SDK for TraceRoot tracing and logging.

## Introduction

This SDK allows you to trace functions and utilizes TraceRoot's own logger within the TraceRoot trace. It captures all the context designed for advanced debugging of AI agents.

### OpenTelemetry

The trace is built upon OpenTelemetry, and the traces will be sent to TraceRoot's own endpoint.

### Winston

The logger is based on Winston, designed for integration with CloudWatch. And currently the logs will be stored in AWS.

## Installation

```bash
npm install traceroot-sdk-ts
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
  enable_span_console_export: true,
  enable_log_console_export: true,

  // Local mode that whether to store all data locally
  local_mode: false,
};
export default config;
```

## Usage

Then you can use the `traceroot.traceFunction` to trace your functions:

```typescript
import * as traceroot from 'traceroot-sdk-ts';

const greet = traceroot.traceFunction(function greet(name: string): string {
  const logger = traceroot.get_logger();
  logger.info(`Greeting inside traced function: ${name}`);
  return `Hello, ${name}!`;
}, { spanName: 'greet' });

greet('world');
```

Or just use the decorator:

```typescript
import * as traceroot from 'traceroot-sdk-ts';

@traceroot.trace({ spanName: 'greet' })
function greet(name: string): string {
  const logger = traceroot.get_logger();
  logger.info(`Greeting inside traced function: ${name}`);
  return `Hello, ${name}!`;
}

greet('world');
```

More details can be found in the [examples](examples).

You can run following examples after modifying the `traceroot.config.ts` file:

```bash
npx ts-node --transpile-only examples/simple-example.ts
npx ts-node --transpile-only examples/simple-example-decorator.ts
```

## Development

```bash
npm install
npm run build
npm run format
npm run lint --fix
npm run test # Run tests
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

npm view traceroot-sdk-ts

# Install the alpha version
npm install traceroot-sdk-ts@alpha
```

## Citation

If you find our exploratory TraceRoot useful in your research, please consider citing:

```bibtex
@article{traceroot_2025,
  title={TraceRoot Is All You Need for Debugging and Tracing},
  author={Zecheng Zhang and Xinwei He},
  year = {2025},
  publisher = {GitHub},
  url = {https://github.com/traceroot-ai/traceroot}
}
```

## Contact Us

Please reach out to founders@traceroot.ai or visit [TraceRoot.AI](https://traceroot.ai) if you do not have these credentials or have any questions.

[company-linkedin-image]: https://custom-icon-badges.demolab.com/badge/LinkedIn-0A66C2?logo=linkedin-white&logoColor=fff
[company-linkedin-url]: https://www.linkedin.com/company/traceroot-ai/
[company-website-image]: https://img.shields.io/badge/website-traceroot.ai-148740
[company-website-url]: https://traceroot.ai
[company-whatsapp-image]: https://img.shields.io/badge/WhatsApp-25D366?logo=whatsapp&logoColor=white
[company-whatsapp-url]: https://chat.whatsapp.com/GzBii194psf925AEBztMir
[company-x-image]: https://img.shields.io/twitter/follow/TracerootAI?style=social
[company-x-url]: https://x.com/TracerootAI
[discord-image]: https://img.shields.io/discord/1395844148568920114?logo=discord&labelColor=%235462eb&logoColor=%23f5f5f5&color=%235462eb
[discord-url]: https://discord.gg/tPyffEZvvJ
[docs-image]: https://img.shields.io/badge/docs-traceroot.ai-0dbf43
[docs-url]: https://docs.traceroot.ai
[npm-image]: https://img.shields.io/npm/v/traceroot-sdk-ts?style=flat-square&logo=npm&logoColor=fff
[npm-url]: https://www.npmjs.com/package/traceroot-sdk-ts
[pypi-image]: https://badge.fury.io/py/traceroot.svg
[pypi-sdk-downloads-image]: https://img.shields.io/pypi/dm/traceroot
[pypi-sdk-downloads-url]: https://pypi.python.org/pypi/traceroot
[pypi-url]: https://pypi.python.org/pypi/traceroot
[testing-image]: https://github.com/traceroot-ai/traceroot/actions/workflows/test.yml/badge.svg
[testing-url]: https://github.com/traceroot-ai/traceroot/actions/workflows/test.yml
[wechat-image]: https://img.shields.io/badge/WeChat-TraceRoot.AI-brightgreen?logo=wechat&logoColor=white
[wechat-url]: https://raw.githubusercontent.com/traceroot-ai/traceroot/refs/heads/main/misc/images/wechat.jpg
[xinwei-x-image]: https://img.shields.io/twitter/follow/xinwei_97?style=social
[xinwei-x-url]: https://x.com/xinwei_97
[zecheng-x-image]: https://img.shields.io/twitter/follow/zechengzh?style=social
[zecheng-x-url]: https://x.com/zechengzh
