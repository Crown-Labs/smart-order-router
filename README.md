# Kittycorn Smart Order Router

Fork of [Uniswap Smart Order Router](https://github.com/Uniswap/smart-order-router), synchronized through `04c7c0b` (4.31.10). Kittycorn package version: **5.0.0**.

Kittycorn integration supports **Base Sepolia (84532) only**, using the deployed Bank/Router/Quoter and USDC, USDT, WETH from `@kittycorn-labs/v4-sdk`. Obsolete Kittycorn chain/address overrides were removed. Ordinary upstream Uniswap chain support remains available.

## Install, build, test

Use Node.js 22+ and sibling repositories `sdks`, `smart-order-router`, `universal-router`. Build the SDK revision in `.sdk-ref` before installing SOR. Local tarballs avoid duplicate JSBI instances caused by mixing Bun workspace links with npm.

From `sdks`:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run g:build
bun run g:pack
```

From `smart-order-router`:

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck:cli
npm test -- --maxWorkers=2
npm run pack:release
```

The build regenerates TypeChain files before compiling; it does not depend on old generated files in your checkout. `pack:release` writes `.packages/kittycorn-labs-smart-order-router-5.0.0.tgz`, replacing local SDK paths with exact npm versions in a temporary manifest. It does not publish or alter source dependencies. CI checks out the pinned SDK commit, builds its packages, and follows this same workflow.

After changing SDK code, build/pack it, install the new tarballs explicitly, and commit the updated `.sdk-ref` and lockfile:

```sh
npm install --ignore-scripts ../sdks/.sdk-packages/*.tgz
```

## Quote current Base Sepolia pools

Set `JSON_RPC_PROVIDER_BASE_SEPOLIA` in your shell, then:

```sh
make quote
```

This reads a quote at one block. It never signs or broadcasts. `DEBUG_ROUTING=true` enables diagnostic logs; provider diagnostics may include RPC information, so do not share them unredacted.

For executable parameters:

```ts
import { AlphaRouter, SwapType } from '@kittycorn-labs/smart-order-router'
import { CurrencyAmount, Percent, TradeType } from '@kittycorn-labs/sdk-core'
import { Protocol } from '@kittycorn-labs/router-sdk'
import { KITTYCORN_BASE_SEPOLIA as config } from '@kittycorn-labs/v4-sdk'

const router = new AlphaRouter({ chainId: 84532, provider })
const result = await router.route(
  CurrencyAmount.fromRawAmount(config.tokens[0].underlying, '1000000'),
  config.tokens[1].underlying,
  TradeType.EXACT_INPUT,
  {
    type: SwapType.KITTYCORN,
    recipient,
    slippageTolerance: new Percent(1, 100),
    // Omit both for direct KittycornRouter execution (ordinary ERC20 allowance).
    universalRouter: deployedKittycornUniversalRouter,
    deadline: Math.floor(Date.now() / 1000) + 300,
  },
  { blockNumber: await provider.getBlockNumber(), protocols: [Protocol.V4] }
)
// Review result.quote and result.route, then send result.methodParameters.
```

The new Universal Router requires token approval to Permit2 plus Permit2 spender approval to the new router. Direct KittycornRouter uses ordinary ERC20 approval and has no deadline argument. Native ETH and direct tToken endpoints are not supported by this Kittycorn builder; use underlying ERC20s. Standard SDK builders reject Tokenize conversion edges rather than encoding them as real pools.

## Tokenize bootstrap volume

Base Sepolia retains the intended fee-generation policy: seek at least `tokenizeRoutePercent: 5` percent through a **real pool containing a registered Tokenize**, even if the total quote is slightly worse. The default `maxTokenizeQuoteLossBps: 50` limits raw quote degradation to 0.5% versus the unconstrained best route. This price preference is separate from execution slippage.

Both fields are routing config options. Set `tokenizeRoutePercent: 0` to disable the preference. If Tokenize already provides the best route, it can receive more than 5%, including 100%. If no feasible route meets the loss budget, fall back to best price. Missing/zero-liquidity quotes do not cause a crash. Exact-input percentages apply to input volume; exact-output percentages apply to requested output volume. A single-route request cannot force a 95/5 split, so use `maxSplits >= 2` when splitting is desired.

The optimizer preserves the original quote set and searches a constrained alternative. Conversion edges may be shared across split legs; actual AMM pools cannot be reused. ERC4626 rates are loaded at the quote block, with virtual assets/shares included; moving latest rates are not cached under an unversioned key. Execution supports splits mixing ordinary underlying pools and Tokenize pools.

## Local fork execution test

Build the sibling Universal Router with `make build`. Start a dedicated Anvil node on Base Sepolia; the following uses a shell RPC variable, not a private key:

```sh
anvil --fork-url "$JSON_RPC_PROVIDER_BASE_SEPOLIA" --chain-id 84532 --port 18546
```

In another terminal:

```sh
npm run check:fork
```

The check accepts only a localhost Anvil URL (`ANVIL_RPC_URL` can change the port), impersonates the configured funded test wallet locally, deploys the new router, and executes all six token directions with exact input/output through both direct and Universal Router paths. It checks real balances, input/output limits, cleared approvals, and EIP-170 size, then restores its snapshots. This is not a public-chain broadcast.

To exercise a forced Tokenize split even when the testnet's ordinary pool price is far from parity, use this **test-only** loss-budget override:

```sh
CHECK_INPUT=USDT CHECK_MAX_QUOTE_LOSS_BPS=10000 CHECK_REQUIRE_TOKENIZE=true npm run check:fork
```

Offline unit tests cover the price-loss cap and fallback behavior separately. The old mainnet Hardhat route suite and Oclif CLI were removed; the remaining remote provider tests under `test/integ/providers` require their corresponding RPCs and are not part of `npm test`. Kittycorn execution is covered by the local fork check above.

## Publish and deploy

Publish the six SDK packages first (`bun run g:release` in `sdks`). Then, after the SOR build/tests above:

```sh
npm run npm:publish
```

Alternatively run **Release Kittycorn router** manually in GitHub Actions with `NPM_TOKEN` in the `npm-release` environment. Neither normal pushes nor `pack:release` publish anything.

The SOR is an npm library: no smart contract is deployed from this repository. Deploy the new KittycornUniversalRouter using `make deploy chain=base-sepolia broadcast=true wallet=deployer` in `universal-router`, verify it with that repository's `make deploy-check`, and configure its address in the application. Existing Kittycorn Bank, Tokenize contracts, and LPs are reused.

## Dependency security

Ethers v5 currently pins a vulnerable WebSocket dependency. Applications consuming these packages must put the following override in their **root** package.json (dependency-package overrides are ignored by npm):

```json
{ "overrides": { "ws": "8.21.0" } }
```

Run `npm install` and `npm audit` after adding it. This repository already applies the override. A clean consumer install was checked with the same setting. It must remain until upstream Ethers v5 updates its pin or the integration migrates to a compatible replacement.

A Low advisory remains in Ethers v5's transitive `elliptic` dependency ([GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84)); upstream reports no patched version. Our production code builds quotes/calldata and uses external RPC signers; it does not generate ECDSA signatures from user private keys. This is a scope assessment, not a fix or a zero-vulnerability claim. Do not use Ethers v5 local-wallet signing as a workaround for deployment keystores.

## Maintenance scope

Runtime dependencies no longer install Solidity compiler/Hardhat trees for ABI imports. Eight source ABI snapshots in `abi/` have pinned provenance and checksums in `scripts/abi-sources.json`. Run `npm run check:abis` locally and `npm run check:abis -- --verify-upstream` when updating them. OP Stack fee estimation calls the canonical GasPriceOracle directly with the same unsigned transaction envelope, avoiding the unused Optimism bridge SDK.

`npm run check:liquidity` sweeps exact-input sizes for each token direction on the dedicated local Anvil fork. It compares default routing, Tokenize-only and ordinary-only pools, executes each quote with 1% slippage, then restores the same state. Local faucet/wrapped-ETH funding removes wallet balance as the limiting factor. `.reports/liquidity.json` records the block, amounts, venue share, price degradation, and execution results. Grid upper bounds are not claims of an absolute swap maximum.

Jest also retains the Low development-only `deepmerge` advisory ([GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)), with no patched release. It merges trusted local test configuration, not swap input. CI fails for Moderate or higher advisories; Low exceptions remain visible in full audit output.
