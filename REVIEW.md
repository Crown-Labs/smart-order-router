# Integration review — 2026-11-10

## Corrected

- Replaced obsolete Kittycorn addresses and 1:1 conversion assumptions with the current Base Sepolia SDK registry and ERC4626 rates.
- Quote providers read the virtual asset/share ratio at the quote block; unpinned latest rates are not reused from cache.
- Conversion edges do not consume AMM hop budget or prevent otherwise pool-disjoint split routes. Actual AMM pools still cannot be reused.
- Plain underlying V4 pools, Tokenize pools, and splits combining them settle their respective pool currencies correctly.
- Restored Tokenize fee-generation preference: 5% minimum where feasible, independently configurable from the total quote-loss budget and transaction slippage. Search applies the raw-price budget before selecting the gas-adjusted winner.
- SDKs reject unsupported Kittycorn chains, native/direct-share endpoints, sentinel recipients, and invalid slippage. Ordinary Universal Router encoders reject conversion edges.
- New Universal Router caps action-router allowance, refunds only the current call's unused funds, clears approvals, rejects fee-on-transfer funding, and retains upstream reentrancy/deadline protection.
- Removed unconditional debugging, old deployment-specific overrides, and the unused `build` npm dependency. Updated Axios, Lodash, Ethers, and vulnerable compatible transitive versions.
- Replaced cross-workspace links with packed SDK dependencies to avoid multiple JSBI class identities. Fixed SDK ESM resolution and stale Turbo build-cache inputs.
- SOR builds regenerate TypeChain sources; releases stage manifests with published versions without rewriting local files. Publishing is manual and separate from contract deployment.

## Validation

- SDK: 1,443 passing tests, 4 pre-existing skips.
- Universal Router: 65 passing offline tests, including 256 funding/refund fuzz runs; deployed runtime fits EIP-170.
- SOR: full offline unit suite, TypeScript library/CLI builds, a clean `npm ci`, packaged CJS/SDK ESM imports, and installation into a separate consumer directory.
- Base Sepolia fork: all six USDC/USDT/WETH directions, exact input/output, direct action router and new Universal Router (24 executions). Additional executions cover a 95% ordinary-pool / 5% Tokenize split and all-Tokenize routes through real Permit2.
- Deployment script simulation and `make deploy-check` run against the local newly deployed Universal Router. Snapshot state is restored; no public transactions or npm publishes were performed.

## Remaining boundaries

- Current Kittycorn endpoints are USDC, USDT and WETH underlying ERC20s. Native ETH/direct tToken endpoints are deliberately rejected by the builder.
- Quote-loss preference is not an on-chain oracle guarantee. Callers review the resulting quote, set slippage, and use the Universal Router deadline when needed. The direct action router has no deadline argument.
- Testnet ordinary pool prices can differ substantially from Tokenize pools. The default 0.5% total-quote loss budget can skip the 5% preference. It can be configured independently; test-only overrides do not change deployment defaults.
- Offline checks do not execute the five upstream Universal Router mainnet fork suites or SOR's remote multi-chain integration suites. Standard upstream compatibility is covered by available unit tests, not a live execution claim for every chain.
- `npm audit --omit=dev` after compatible updates reports 0 critical, 23 high, 14 moderate and 21 low advisories. Remaining advisories include upstream contract/artifact dependency trees and their transitive tooling; they have not all been proven reachable in this integration. Resolving every advisory would require separately reviewing upstream package/major-version replacements. Do not interpret the passing integration tests as a clean dependency security audit.
- `.vscode/settings.json` edits that existed before this work are preserved locally and excluded from commits.
