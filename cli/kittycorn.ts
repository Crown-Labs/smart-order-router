import { JsonRpcProvider } from '@ethersproject/providers';
import { Protocol } from '@kittycorn-labs/router-sdk';
import { CurrencyAmount, TradeType } from '@kittycorn-labs/sdk-core';
import bunyan from 'bunyan';
import 'dotenv/config';
import { AlphaRouter, setGlobalLogger } from '../src';
import { KITTYCORN_BASE_SEPOLIA as config } from '../src/util/tokenize';

/** Read a quote against the current deployment at one pinned block; never sign or broadcast. */
async function main() {
  const rpc =
    process.env.JSON_RPC_PROVIDER_BASE_SEPOLIA ||
    process.env.RPC_BASE_SEPOLIA_FORK_URL;
  if (!rpc)
    throw new Error(
      'Set JSON_RPC_PROVIDER_BASE_SEPOLIA or RPC_BASE_SEPOLIA_FORK_URL in smart-order-router/.env or your shell'
    );
  const provider = new JsonRpcProvider(rpc, config.chainId);
  const network = await provider.getNetwork();
  if (network.chainId !== config.chainId)
    throw new Error('Expected Base Sepolia');
  const blockNumber = await provider.getBlockNumber();
  if (process.env.DEBUG_ROUTING === 'true')
    setGlobalLogger(bunyan.createLogger({ name: 'kittycorn', level: 'debug' }));
  const router = new AlphaRouter({ chainId: config.chainId, provider });
  const result = await router.route(
    CurrencyAmount.fromRawAmount(config.tokens[0]!.underlying, '1000000'),
    config.tokens[1]!.underlying,
    TradeType.EXACT_INPUT,
    undefined,
    {
      blockNumber,
      protocols: [Protocol.V4],
      maxSwapsPerPath: 2,
      maxSplits: 2,
      distributionPercent: 50,
    }
  );
  if (!result) throw new Error('No executable Kittycorn route found');
  console.log('Base Sepolia block:', blockNumber);
  console.log('Kittycorn Bank:', config.bank);
  console.log(
    'Quote:',
    result.trade.inputAmount.toExact(),
    'USDC ->',
    result.quote.toExact(),
    'USDT'
  );
  console.log('Price impact:', result.trade.priceImpact.toFixed(4), '%');
  for (const r of result.route)
    console.log(
      'Route:',
      r.route.input.symbol,
      '->',
      r.route.output.symbol,
      'protocol:',
      r.route.protocol,
      'percent:',
      r.percent
    );
}
main().catch((error) => {
  // Provider errors may contain authenticated RPC URLs; expose the error code without request details.
  console.error(
    error.code ||
      (error instanceof Error && !('requestBody' in error)
        ? error.message
        : 'Quote failed')
  );
  process.exitCode = 1;
});
