.PHONY: build test quote sdk-update

build: ## Build CommonJS and ES modules
	npm run build

test: ## Run unit tests
	npm test -- --maxWorkers=2

quote: ## Quote current Kittycorn Base Sepolia deployment (read-only)
	npm run dev

sdk-update: ## Pin all six SDKs to the latest complete npm release
	npm run sdk:update
