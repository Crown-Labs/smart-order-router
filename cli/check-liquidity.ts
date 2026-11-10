import { Protocol } from '@kittycorn-labs/router-sdk';
import { CurrencyAmount, Percent, TradeType } from '@kittycorn-labs/sdk-core';
import { KITTYCORN_BASE_SEPOLIA as config } from '@kittycorn-labs/v4-sdk';
import { strict as assert } from 'assert';
import { BigNumber, Contract, constants, providers, utils } from 'ethers';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { AlphaRouter, isTokenizeRoute, SwapType } from '../src';

/** Expose discovery only to freeze the test's pool catalog at one fork block. */
class LiquidityRouter extends AlphaRouter {
  pools(blockNumber: number) {
    return this.v4SubgraphProvider.getPools(undefined, undefined, {
      blockNumber,
    });
  }
}

/** Sweep actual liquidity with synthetic local funding; never connect to a public execution RPC. */
async function main() {
  for (const key of ['CHECK_INPUT', 'CHECK_OUTPUT']) {
    const symbol = process.env[key];
    assert(
      !symbol || config.tokens.some((t) => t.underlying.symbol === symbol),
      `Unsupported ${key}`
    );
  }
  assert(
    !process.env.CHECK_INPUT ||
      process.env.CHECK_INPUT !== process.env.CHECK_OUTPUT,
    'Choose distinct tokens'
  );
  const rpc = process.env.ANVIL_RPC_URL || 'http://127.0.0.1:18546';
  assert(
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(rpc).hostname),
    'Local RPC required'
  );
  const provider = new providers.StaticJsonRpcProvider(rpc, 84532);
  assert(
    (await provider.send('web3_clientVersion', []))
      .toLowerCase()
      .includes('anvil'),
    'Anvil required'
  );
  assert.equal(Number(await provider.send('eth_chainId', [])), 84532);
  const forkBlock = await provider.getBlock('latest');
  const original = await provider.send('evm_snapshot', []);
  const account = '0xfff0BF131DAEa9bA4e97829D2d3043aaef3213ff';
  const rows: Record<string, unknown>[] = [];
  try {
    await provider.send('anvil_setBlockTimestampInterval', [1]);
    await provider.send('anvil_impersonateAccount', [account]);
    await provider.send('anvil_setBalance', [
      account,
      utils.parseEther('20000').toHexString(),
    ]);
    const signer = provider.getSigner(account);
    const abi = [
      'function balanceOf(address) view returns (uint256)',
      'function approve(address,uint256) returns (bool)',
      'function owner() view returns (address)',
      'function deposit() payable',
    ];
    const tokens = config.tokens.map(
      ({ underlying }) => new Contract(underlying.address, abi, signer)
    );
    // Funding changes only wallet balances on this disposable fork, never pool reserves.
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (config.tokens[i]!.underlying.decimals === 18) {
        await (
          await token.deposit({ value: utils.parseEther('10000') })
        ).wait();
      } else {
        // The public faucet caps each mint. Impersonate its authority locally so
        // that this measures pool capacity rather than the faucet's daily budget.
        const owner: string = await token.owner();
        await provider.send('anvil_impersonateAccount', [owner]);
        await provider.send('anvil_setBalance', [
          owner,
          utils.parseEther('1').toHexString(),
        ]);
        try {
          const mint = new Contract(
            token.address,
            ['function mint(address,uint256) returns (bool)'],
            provider.getSigner(owner)
          );
          await (
            await mint.mint(account, utils.parseUnits('10000000', 6))
          ).wait();
        } finally {
          await provider.send('anvil_stopImpersonatingAccount', [owner]);
        }
      }
      await (await token.approve(config.router, constants.MaxUint256)).wait();
    }
    // Quote canonical fork state. Local wallet funding does not change pool liquidity.
    const blockNumber = forkBlock.number;
    const catalog = await new LiquidityRouter({
      chainId: 84532,
      provider,
    }).pools(blockNumber);
    const tokenize = new Set(
      config.tokens.map((t) => t.tokenize.address.toLowerCase())
    );
    const modePools = {
      default: catalog,
      tokenize: catalog.filter(
        (p) =>
          tokenize.has(p.token0.id.toLowerCase()) ||
          tokenize.has(p.token1.id.toLowerCase())
      ),
      ordinary: catalog.filter(
        (p) =>
          !tokenize.has(p.token0.id.toLowerCase()) &&
          !tokenize.has(p.token1.id.toLowerCase())
      ),
    };
    console.log(
      'Liquidity sweep: fork block',
      forkBlock.number,
      'quote block',
      blockNumber
    );
    for (const [i, input] of config.tokens.entries()) {
      if (
        process.env.CHECK_INPUT &&
        input.underlying.symbol !== process.env.CHECK_INPUT
      )
        continue;
      const amounts =
        input.underlying.decimals === 18
          ? ['0.0001', '0.001', '0.01', '0.1', '1', '10', '100', '1000']
          : ['1', '10', '100', '1000', '10000', '100000', '1000000'];
      for (const [j, output] of config.tokens.entries()) {
        if (
          i === j ||
          (process.env.CHECK_OUTPUT &&
            output.underlying.symbol !== process.env.CHECK_OUTPUT)
        )
          continue;
        for (const mode of ['default', 'tokenize', 'ordinary'] as const) {
          const router = new AlphaRouter({
            chainId: 84532,
            provider,
            v4SubgraphProvider: { getPools: async () => modePools[mode] },
          });
          let baselineRate: number | undefined;
          const modeStart = rows.length;
          const checkAmount = async (amount: string) => {
            const row: Record<string, unknown> = {
              pair: `${input.underlying.symbol}/${output.underlying.symbol}`,
              mode,
              amount,
            };
            let snapshot: string | undefined;
            try {
              const result = await router.route(
                CurrencyAmount.fromRawAmount(
                  input.underlying,
                  utils.parseUnits(amount, input.underlying.decimals).toString()
                ),
                output.underlying,
                TradeType.EXACT_INPUT,
                {
                  type: SwapType.KITTYCORN,
                  recipient: account,
                  slippageTolerance: new Percent(1, 100),
                },
                {
                  blockNumber,
                  protocols: [Protocol.V4],
                  maxSwapsPerPath: 2,
                  maxSplits: 2,
                  distributionPercent: 50,
                  // Disable discovery outside the frozen venue catalog.
                  ...(mode !== 'default'
                    ? {
                        v4PoolSelection: {
                          topNDirectSwaps: 0,
                          topN: 100,
                          topNTokenInOut: 100,
                          topNSecondHop: 100,
                          topNWithEachBaseToken: 100,
                          topNWithBaseToken: 100,
                        },
                      }
                    : {}),
                  tokenizeRoutePercent: mode === 'default' ? 5 : 0,
                  maxTokenizeQuoteLossBps: 50,
                  useCachedRoutes: false,
                  writeToCachedRoutes: false,
                }
              );
              if (!result?.methodParameters) {
                row.status = 'NO_ROUTE';
                return row;
              }
              const percent = result.route
                .filter((r) => isTokenizeRoute(r.route))
                .reduce((s, r) => s + r.percent, 0);
              assert(
                mode !== 'tokenize' || percent === 100,
                'Non-Tokenize route leaked into isolated mode'
              );
              assert(
                mode !== 'ordinary' || percent === 0,
                'Tokenize route leaked into isolated mode'
              );
              const quote = result.quote.toExact();
              const rate = Number(quote) / Number(amount);
              baselineRate ??= rate;
              Object.assign(row, {
                quote,
                tokenizePercent: percent,
                priceDegradationPercent: (1 - rate / baselineRate) * 100,
              });
              // Preserve RPC reads in the fork cache; only execution mutates chain state.
              snapshot = await provider.send('evm_snapshot', []);
              const beforeIn: BigNumber = await tokens[i]!.balanceOf(account);
              const beforeOut: BigNumber = await tokens[j]!.balanceOf(account);
              const params = result.methodParameters;
              const hash = await signer.sendUncheckedTransaction({
                to: params.to,
                data: params.calldata,
                value: params.value,
                gasLimit: 12000000,
              });
              let receipt: { status: string } | null = null;
              for (let k = 0; k < 300 && !receipt; k++) {
                receipt = await provider.send('eth_getTransactionReceipt', [
                  hash,
                ]);
                if (!receipt)
                  await new Promise((resolve) => setTimeout(resolve, 100));
              }
              if (receipt?.status !== '0x1') {
                row.status = 'EXECUTION_REVERT';
                try {
                  await provider.call(
                    {
                      from: account,
                      to: params.to,
                      data: params.calldata,
                      value: params.value,
                      gasLimit: 12000000,
                    },
                    'latest'
                  );
                } catch (error) {
                  row.error =
                    error instanceof Error
                      ? error.message.replace(/https?:\/\/[^\s"']+/g, '<RPC>')
                      : String(error);
                }
              } else {
                const paid = beforeIn.sub(await tokens[i]!.balanceOf(account));
                const received = (await tokens[j]!.balanceOf(account)).sub(
                  beforeOut
                );
                assert(paid.gt(0) && received.gt(0), 'Empty swap');
                assert(
                  paid.lte(utils.parseUnits(amount, input.underlying.decimals)),
                  'Input overspent'
                );
                assert(
                  received.gte(
                    result.trade
                      .minimumAmountOut(new Percent(1, 100))
                      .quotient.toString()
                  ),
                  'Output minimum violated'
                );
                Object.assign(row, {
                  status: 'PASS',
                  paid: utils.formatUnits(paid, input.underlying.decimals),
                  received: utils.formatUnits(
                    received,
                    output.underlying.decimals
                  ),
                });
              }
            } catch (error) {
              row.status = 'ERROR';
              row.error =
                error instanceof Error
                  ? error.message.replace(/https?:\/\/[^\s"']+/g, '<RPC>')
                  : String(error);
            } finally {
              if (snapshot)
                assert(await provider.send('evm_revert', [snapshot]));
              rows.push(row);
              console.log(JSON.stringify(row));
              mkdirSync('.reports', { recursive: true });
              writeFileSync(
                '.reports/liquidity.json',
                JSON.stringify(
                  {
                    forkBlock: forkBlock.number,
                    forkTimestamp: forkBlock.timestamp,
                    quoteBlock: blockNumber,
                    slippageBps: 100,
                    maxTokenizeQuoteLossBps: 50,
                    syntheticLocalFunding: true,
                    routing: {
                      protocols: ['V4'],
                      maxSwapsPerPath: 2,
                      maxSplits: 2,
                      distributionPercent: 50,
                    },
                    note: 'Grid measurements capped at 20% price degradation or the largest input, not an absolute maximum. Price degradation is versus the smallest quote in the same mode. Each execution restores the same snapshot.',
                    rows,
                  },
                  null,
                  2
                )
              );
            }
            return row;
          };
          for (const amount of amounts) {
            const row = await checkAmount(amount);
            if (Number(row.priceDegradationPercent) >= 20) break;
          }
          // Optional boundary refinement: keep a passing lower bound, never claim
          // the interpolated quote or an untested amount is executable.
          if (process.env.CHECK_REFINE === 'true') {
            for (const limit of [1, 5]) {
              for (let attempt = 0; attempt < 10; attempt++) {
                const samples = rows
                  .slice(modeStart)
                  .filter((r) => r.status === 'PASS');
                const lower = samples
                  .filter((r) => Number(r.priceDegradationPercent) <= limit)
                  .sort((a, b) => Number(b.amount) - Number(a.amount))[0];
                if (!lower) break;
                const upper = samples
                  .filter(
                    (r) =>
                      Number(r.priceDegradationPercent) > limit &&
                      Number(r.amount) > Number(lower.amount)
                  )
                  .sort((a, b) => Number(a.amount) - Number(b.amount))[0];
                if (!upper) break;
                const lo = utils.parseUnits(
                  String(lower.amount),
                  input.underlying.decimals
                );
                const hi = utils.parseUnits(
                  String(upper.amount),
                  input.underlying.decimals
                );
                if (hi.sub(lo).lte(lo.div(100).add(1))) break;
                const row = await checkAmount(
                  utils.formatUnits(
                    lo.add(hi).div(2),
                    input.underlying.decimals
                  )
                );
                if (row.status !== 'PASS') break;
              }
            }
          }
        }
      }
    }
  } finally {
    await provider.send('anvil_removeBlockTimestampInterval', []);
    await provider.send('anvil_stopImpersonatingAccount', [account]);
    assert(await provider.send('evm_revert', [original]));
  }
  const groups = [...new Set(rows.map((row) => row.pair + ':' + row.mode))];
  const summary = groups.map((group) => {
    const samples = rows.filter(
      (row) => row.pair + ':' + row.mode === group && row.status === 'PASS'
    );
    const largest = (limit: number) =>
      samples
        .filter((row) => Number(row.priceDegradationPercent) <= limit)
        .sort((a, b) => Number(b.amount) - Number(a.amount))[0]?.amount ?? null;
    return {
      group,
      testedWithin1Percent: largest(1),
      testedWithin5Percent: largest(5),
      largestExecutedInput: largest(Infinity),
    };
  });
  assert(rows.length > 0, 'No measurements were selected');
  const report = JSON.parse(readFileSync('.reports/liquidity.json', 'utf8'));
  writeFileSync(
    '.reports/liquidity.json',
    JSON.stringify(
      {
        ...report,
        summary,
        tokens: config.tokens.map((t) => ({
          symbol: t.underlying.symbol,
          underlying: t.underlying.address,
          tokenize: t.tokenize.address,
        })),
      },
      null,
      2
    )
  );
  console.table(summary);
  assert(
    !rows.some(
      (row) => row.status === 'ERROR' || row.status === 'EXECUTION_REVERT'
    ),
    'Some measurements failed; inspect .reports/liquidity.json'
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
