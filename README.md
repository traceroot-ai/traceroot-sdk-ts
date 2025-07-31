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

A TypeScript SDK for TraceRoot tracing and logging, providing the same functionality as the Python version with OpenTelemetry tracing and Winston logging.

```bash
npm install
npm run build
npm run format
npm run lint --fix
npx ts-node --transpile-only examples/simple-example.ts
```

Publish to npm
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
[npm-image]: https://img.shields.io/npm/v/traceroot-sdk-ts?style=flat-square&logo=npm&logoColor=fff
[npm-url]:   https://www.npmjs.com/package/traceroot-sdk-ts
