format:
	npm run build
	npm run format
	npm run lint --fix

test:
	npm run test
	npx tsc --noEmit
