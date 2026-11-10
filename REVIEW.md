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
- Replaced cross-workspace links with packed SDK dependencies to avoid multiple JSBI class identities. Fixed SDK ESM resolution; the unused Turbo/Hardhat workspace toolchains have since been removed.
- SOR builds regenerate TypeChain sources; releases stage manifests with published versions without rewriting local files. Publishing is manual and separate from contract deployment.

## Validation

- SDK: 2,181 passing tests, 4 pre-existing skips.
- Universal Router: 65 passing offline tests, including 256 funding/refund fuzz runs; deployed runtime fits EIP-170.
- SOR: 325 passing offline tests (2 pre-existing skips), full offline unit suite, TypeScript library/CLI builds, a clean `npm ci`, packaged CJS/SDK ESM imports, and installation into a separate consumer directory.
- Base Sepolia fork: all six USDC/USDT/WETH directions, exact input/output, direct action router and new Universal Router (24 executions). Additional executions cover a 95% ordinary-pool / 5% Tokenize split and all-Tokenize routes through real Permit2.
- Deployment script simulation and `make deploy-check` run against the local newly deployed Universal Router. Snapshot state is restored; no public transactions or npm publishes were performed.

## Remaining boundaries

- Current Kittycorn endpoints are USDC, USDT and WETH underlying ERC20s. Native ETH/direct tToken endpoints are deliberately rejected by the builder.
- Quote-loss preference is not an on-chain oracle guarantee. Callers review the resulting quote, set slippage, and use the Universal Router deadline when needed. The direct action router has no deadline argument.
- Testnet ordinary pool prices can differ substantially from Tokenize pools. The default 0.5% total-quote loss budget can skip the 5% preference. It can be configured independently; test-only overrides do not change deployment defaults.
- Offline checks do not execute the five upstream Universal Router mainnet fork suites or SOR's remote multi-chain integration suites. Standard upstream compatibility is covered by available unit tests, not a live execution claim for every chain.
- Dependency audit after pruning/reinstall: Universal Router 0 findings; SDK Bun audit 1 Low advisory; SOR full npm audit 0 Critical/High/Moderate and 26 Low impacted package entries (19 production entries). These SOR entries cascade from two distinct unpatched advisories: elliptic (runtime Ethers v5 dependency) and deepmerge (Jest development configuration). We did not downgrade or hide them to claim a clean audit. See the linked advisories in README.md.
- The ws patch is an application-root override. It is not inherited from a published SDK/SOR package. A clean consumer install with the documented override has 0 Critical/High/Moderate and 19 Low cascading elliptic entries. Consumers must keep that override until upstream dependency pins change.
- `.vscode/settings.json` edits that existed before this work are preserved locally and excluded from commits.

## Lean dependency review

- Retained six SDK workspaces actually required by the route/trade dependency graph. Removed unused products, embedded Solidity toolchains, and old SDK fork harnesses; expanded the maintained offline encoding suite.
- Replaced complete Solidity artifact dependencies with 17 SDK and 8 SOR ABI/bytecode snapshots. Verified every snapshot against its pinned npm source. Bytecode fixtures are test-only.
- Universal Router now uses Foundry alone. Removed legacy mainnet Hardhat integration/gas snapshots and old-chain deploy scripts; this narrows historical upstream coverage and is explicitly documented. All existing Foundry suites remain.
- SOR no longer installs the old Hardhat route harness, Oclif CLI, or unused NYC tooling. Kept unit tests and the Base Sepolia execution matrix. Removed Optimism bridge SDK in favor of the same canonical fee-oracle calls, covered by an unsigned-envelope regression test.
- Fresh dependency resolution exposed an upstream token-lists beta package without dist files; pinned the usable beta.31 release. Updated TypeScript/Node types, narrowed unknown GraphQL errors, and handled Brotli compression failure explicitly.
- No public-chain transactions or npm releases were performed.
