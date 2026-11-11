# Integration review — 2026-11-10

## Corrected

- Replaced obsolete Kittycorn addresses and 1:1 conversion assumptions with the current Base Sepolia SDK registry and ERC4626 rates.
- Quote providers read the virtual asset/share ratio at the quote block; unpinned latest rates are not reused from cache.
- Conversion edges do not consume AMM hop budget or prevent otherwise pool-disjoint split routes. Actual AMM pools still cannot be reused.
- Plain underlying V4 pools, Tokenize pools, and splits combining them settle their respective pool currencies correctly.
- Restored Tokenize fee-generation preference: 5% minimum where feasible, independently configurable from the total quote-loss budget and transaction slippage. Search applies the raw-price budget before selecting the gas-adjusted winner.
- SDKs reject unsupported Kittycorn chains, direct-share endpoints, sentinel recipients, and invalid slippage. Native support is restored in the follow-up below. Ordinary Universal Router encoders reject conversion edges.
- New Universal Router caps action-router allowance, refunds only the current call's unused funds, clears approvals, rejects fee-on-transfer funding, and retains upstream reentrancy/deadline protection.
- Removed unconditional debugging, old deployment-specific overrides, and the unused `build` npm dependency. Updated Axios, Lodash, Ethers, and vulnerable compatible transitive versions.
- Replaced cross-workspace links with packed SDK dependencies to avoid multiple JSBI class identities. Fixed SDK ESM resolution; the unused Turbo/Hardhat workspace toolchains have since been removed.
- SOR builds regenerate TypeChain sources; releases stage manifests with published versions without rewriting local files. Publishing is manual and separate from contract deployment.

## Validation

- SDK: 2,185 passing tests, 4 pre-existing skips.
- Universal Router: 71 passing offline tests, including 256 funding/refund fuzz runs; deployed runtime fits EIP-170.
- SOR: 346 passing offline tests (2 pre-existing skips), full offline unit suite, TypeScript library/CLI builds, a clean `npm ci`, packaged CJS/SDK ESM imports, and installation into a separate consumer directory.
- Base Sepolia fork: all six USDC/USDT/WETH directions, exact input/output, direct action router and new Universal Router (24 executions). Additional executions cover a 95% ordinary-pool / 5% Tokenize split and all-Tokenize routes through real Permit2.
- Deployment script simulation and `make deploy-check` run against the local newly deployed Universal Router. Snapshot state is restored; no public transactions or npm publishes were performed.

## Follow-up review — route display and all three repositories

- Restored the original full `routeString:` format, including every underlying/share hop, protocol, percentage, fee and pool ID. Only exact registered conversion identities and the native wrapping sentinel display a zero ID; real pools containing a Tokenize still show their actual ID. A read-only quote at block 56998602 returned 1 USDC → 1.000718 USDT through tUSDC/tUSDT (100%, 0.01% AMM fee).
- Reproduced a missed Tokenize preference in both exact-input and exact-output searches: the best gas-ranked complementary candidate could exceed the raw-price budget while a later candidate satisfied it. Both regression tests failed before the fix. Budget filtering now occurs before selecting that complementary leg; the configured default 5% preference and 50-bps total quote-loss cap are unchanged.
- Invalid `distributionPercent=0` could loop indefinitely; non-divisor increments such as 30 omitted the 100% unsplit quote. Validate integer increments 1–100 and always include 100%.
- `SwapType.KITTYCORN` could search unsupported protocols when the caller omitted `protocols`. Default it to V4 and reject explicit incompatible protocols/chains before RPC work. The fork matrix deliberately omits the protocol override to validate this behavior. RPC lookup and the CLI now share the same Base Sepolia environment-variable aliases.
- SDK split minima could lose up to one raw unit per additional leg through independent rounding. A two-leg quote of 101 + 101 with 1% slippage encoded 99 + 99, below the reported 199-unit minimum. The regression failed before the fix. Cumulative rounding now preserves the aggregate minimum; tests cover two/three legs and 0%, 1%, 25%, 99% slippage, with each minimum bounded by its leg's quote. SOR pins the corrected SDK commit and tarball integrity.
- Universal Router review added six tests for nested payer/refund context, multi-command rollback, allowed sub-plan failure, direct failure flags, cross-token funding isolation and uint160 overflow. These passed without a contract change. A clean Foundry rebuild matches the recorded compiler-audit creation/runtime hashes; runtime remains 24,193 bytes. The stale deleted-source artifact was removed by `forge clean`.
- Reviewed maintained source differences from pinned upstream, ERC4626 registration/rate reads, endpoint conversion rules, pool reuse, slippage/funding/refunds, deployment configuration, ABI snapshots, build/pack scripts and manual release workflows. All six SDK tarballs and SOR were installed into a fresh consumer directory: CJS imports for all seven and native Node ESM imports for all six SDKs passed. Dependency audit findings remain as documented below.
- Re-ran all 24 actual swap executions on a dedicated local fork of Base Sepolia block 56998593: all six token directions, both trade types, both executors. Snapshot restoration succeeded. The older 345-measurement liquidity report below remains historical evidence at its recorded block; it was not rerun or relabeled as a new sweep.
- Eight additional executions passed with the documented test-only price-budget override. USDT → USDC used 95% ordinary liquidity / 5% Tokenize for both exact-input and exact-output, through both routers; USDT → WETH used 100% Tokenize. All balance/aggregate-slippage/allowance assertions and final snapshot restoration passed. Total follow-up execution coverage: 32 successful swaps, zero failures.

This is a source/integration review with regression and execution tests, not a formal audit guarantee. Upstream fork suites and unconfigured pools/chains remain outside the executed coverage.

## Native ETH review — 2026-11-11

- Confirmed a client regression: API rejected native endpoints, SOR did not connect ETH endpoints to WETH pools, and the Kittycorn Universal SDK omitted wrap/unwrap and always set transaction value to zero. Historical SDK source (`493835b`) contained native handling. Restored ETH → WETH → tWETH → pool and reverse paths, including native address aliases, Permit2 exclusion for ETH, original-payer refunds and output-recipient delivery.
- Preserved fractional split quote totals with `CurrencyAmount.wrapped`. The regression test fails before the fix: two fractional legs encoded a 19,801-unit minimum while the aggregate trade required 19,802. Integer on-chain quote amounts are unaffected.
- Eight native executions passed on a dedicated fork of Base Sepolia block **57315218**, against existing router **0x02D353c5cA5e316bBd99FAC6a481eB8b778Ea67d**: ETH ↔ USDC/USDT, exact input/output. All used Tokenize pools, with actual balance/limit checks, distinct payer/recipient, no native-input token approval, exact-output refunds, no residual ETH/WETH/allowance, and restored snapshots. The test-only preference budget was 500 bps; defaults are unchanged.
- API quote → serialization → encoding passed ten cases at that block (eight native plus both USDC → USDT trade types). Calldata, destination and value match the SDK. API tests: **2,681 passed / 92 suites**. Tests used locally rebuilt dependencies, not a public API rollout.
- Re-reviewed maintained upstream differences, routing policy, conversion rates/identity/cache, split rounding, funding, recipients, Permit2, deployment and release scripts. Universal Router now has **73 passing tests**, including two 256-run funding fuzz tests and final-unwrap failure rollback. Production Solidity is unchanged: all compiler-evidence source hashes and both unprefixed-hex bytecode hashes match; runtime remains 24,193 bytes.
- SDK full suite: **2,191 passed, 4 existing skips**; SOR: **346 passed, 2 existing skips**, library/CLI compilation and ABI verification passed. Fresh locally packed six SDKs plus SOR installed into a separate consumer; CJS loading, six native Node ESM imports, and native calldata/value encoding in both directions/trade types passed, including values above JavaScript's safe-integer range. These test tarballs were staged outside the repos without overwriting the existing release artifacts.
- Dependency audit remains SDK **1 Low**, SOR **26 Low impacted package entries** (elliptic and development-only deepmerge), Universal Router **0**. No Critical/High/Moderate findings in these three repos. Both Low advisories lack patched upstream releases; see README for exposure boundaries.
- Release verification: all six published SDK 2.0.1 tarballs match their registry integrity and local release artifacts. SOR 5.0.2 pins all six SDKs to 2.0.1 from npm. `npm run sdk:update` resolves an aligned SDK release before updating dependencies and the lockfile; packaging rejects installed-version mismatches. CI installs the registry lockfile directly, replacing `.sdk-ref` and sibling builds. Four installed-SDK native encoding regressions bring SOR to **350 passing tests, 2 existing skips**. Build, CLI typecheck and release tarball validation pass. SOR 5.0.1 used stale SDK dependencies and was unpublished; consumers must upgrade to 5.0.2.

## Remaining boundaries

- Current Kittycorn endpoints are USDC, USDT, WETH and native ETH. Native ETH requires an explicit Kittycorn Universal Router address and deadline; direct action-router execution remains ERC20-only. Direct tToken user endpoints remain unsupported.
- Quote-loss preference is not an on-chain oracle guarantee. Callers review the resulting quote, set slippage, and use the Universal Router deadline when needed. The direct action router has no deadline argument.
- Testnet ordinary pool prices can differ substantially from Tokenize pools. The default 0.5% total-quote loss budget can skip the 5% preference. It can be configured independently; test-only overrides do not change deployment defaults.
- Offline checks do not execute the five upstream Universal Router mainnet fork suites or SOR's remote multi-chain integration suites. Standard upstream compatibility is covered by available unit tests, not a live execution claim for every chain.
- Dependency audit after pruning/reinstall: Universal Router 0 findings; SDK Bun audit 1 Low advisory; SOR full npm audit 0 Critical/High/Moderate and 26 Low impacted package entries (19 production entries). These SOR entries cascade from two distinct unpatched advisories: elliptic (runtime Ethers v5 dependency) and deepmerge (Jest development configuration). We did not downgrade or hide them to claim a clean audit. See the linked advisories in README.md.
- The ws patch is an application-root override. It is not inherited from a published SDK/SOR package. A clean consumer install with the documented override has 0 Critical/High/Moderate and 20 Low cascading elliptic entries when all six SDKs and SOR are installed (19 for the SDK-only consumer). Consumers must keep that override until upstream dependency pins change.
- `.vscode/settings.json` edits that existed before this work are preserved locally and excluded from commits.

## Lean dependency review

- Retained six SDK workspaces actually required by the route/trade dependency graph. Removed unused products, embedded Solidity toolchains, and old SDK fork harnesses; expanded the maintained offline encoding suite.
- Replaced complete Solidity artifact dependencies with 17 SDK and 8 SOR ABI/bytecode snapshots. Verified every snapshot against its pinned npm source. Bytecode fixtures are test-only.
- Universal Router now uses Foundry alone. Removed legacy mainnet Hardhat integration/gas snapshots and old-chain deploy scripts; this narrows historical upstream coverage and is explicitly documented. All existing Foundry suites remain.
- SOR no longer installs the old Hardhat route harness, Oclif CLI, or unused NYC tooling. Kept unit tests and the Base Sepolia execution matrix. Removed Optimism bridge SDK in favor of the same canonical fee-oracle calls, covered by an unsigned-envelope regression test.
- Fresh dependency resolution exposed an upstream token-lists beta package without dist files; pinned the usable beta.31 release. Updated TypeScript/Node types, narrowed unknown GraphQL errors, and handled Brotli compression failure explicitly.
- No public-chain transactions or npm releases were performed.

## Liquidity execution — Base Sepolia block 56910426

Completed 345 exact-input measurements: **315 successful balance-checked swaps, 30 NO_ROUTE results, zero execution reverts/errors**. Each swap restores its snapshot. The full sweep restored the original fork block. Synthetic funding only changes local wallet balances, not the starting pool reserves. The separate 24-case integration matrix covers exact input/output through both direct and Universal Router execution.

Largest measured inputs at or below each price-degradation threshold (rounded down below; exact below/above-threshold measurements are in [the evidence](audit/liquidity-base-sepolia.json)):

| Direction / venue | Within 1% | Within 5% | Largest executed in grid |
| --- | ---: | ---: | ---: |
| USDC → USDT, Tokenize | 69.06 USDC | 367.18 USDC | 10,000 USDC |
| USDT → USDC, Tokenize | 69.06 USDT | 370.70 USDT | 10,000 USDT |
| USDC → WETH, Tokenize | 54.29 USDC | 370.70 USDC | 10,000 USDC |
| USDT → WETH, Tokenize | 54.29 USDT | 370.70 USDT | 10,000 USDT |
| WETH → USDC, Tokenize | 0.03337 WETH | 0.17470 WETH | 1 WETH |
| WETH → USDT, Tokenize | 0.03337 WETH | 0.17470 WETH | 1 WETH |
| USDC → USDT, ordinary | 281.05 USDC | 1,457.03 USDC | 10,000 USDC |
| USDT → USDC, ordinary | 228.32 USDT | 1,184.57 USDT | 10,000 USDT |

These are measurements, not an absolute AMM maximum or a guarantee for every smaller amount. Price degradation is versus the smallest quote in the same pair/mode, excludes gas, and is separate from the 1% execution-slippage limit. The grid stops after degradation reaches 20% or the configured input ceiling. For example, 1 WETH still executes, but its rate is about 22.8% worse than the smallest trade.

Default-routing observations:

- USDC → USDT used 100% Tokenize at the tested 1/10/100/1,000 USDC points and 5% at 10,000 USDC.
- USDT → USDC used 0% Tokenize at the tested 1/10/100/1,000 USDT points. The ordinary market price was sufficiently better that forcing 5% exceeded the 50-bps total quote-loss budget. At 1,562.5 USDT and other tested larger points, a 5% Tokenize split passed. The exact policy transition was not separately bisected.
- The WETH directions used 100% Tokenize in default routing throughout the tested grid.
- Ordinary-only WETH routes were absent for these configured Aave USDC/USDT addresses. The discovered ordinary WETH pools instead use Circle USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e). This is not a claim that Base Sepolia has no ordinary WETH liquidity.
- Ordinary stablecoin prices were not 1:1: the smallest quotes were about 0.809 USDT per USDC and 1.235 USDC per USDT. An impact bound relative to those quotes is not a dollar-parity guarantee.

The scope is the configured V4 catalog, at most two AMM hops and two split legs. A read-only comparison at public block 56973957 found all ten discovered pools' liquidity and sqrt prices unchanged; ERC4626 rates can still accrue interest. Raw measurements remain in generated `.reports/liquidity.json`; the committed evidence records their hash, token/pool identities, counts, and exact measured bounds. Reproduce on a fresh fork at the recorded block with `CHECK_REFINE=true npm run check:liquidity`.
