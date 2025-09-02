# Development

## Commands for development

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

## Run example

```bash
npx ts-node --transpile-only examples/log-level-example.ts
```

## Publish to npm

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
