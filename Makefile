format:
	npm run build
	npm run format
	npm run lint --fix

test:
	npm run test
	npx tsc --noEmit

alpha:
	npm version prerelease --preid=alpha
	npm publish --tag alpha
