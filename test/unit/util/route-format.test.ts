import { Protocol } from '@kittycorn-labs/router-sdk';
import { ChainId, CurrencyAmount } from '@kittycorn-labs/sdk-core';
import { encodeSqrtRatioX96 } from '@kittycorn-labs/v3-sdk';
import {
  getTokenizePairs,
  KITTYCORN_BASE_SEPOLIA as config,
  Pool,
} from '@kittycorn-labs/v4-sdk';
import { RouteWithValidQuote, V4Route } from '../../../src';
import { V4_ETH_WETH_FAKE_POOL } from '../../../src/util/pool';
import {
  poolToString,
  routeAmountsToString,
  routeToString,
} from '../../../src/util/routes';

const [usdc, usdt] = config.tokens;
const zero = '0x0000000000000000000000000000000000000000';
const zeroId = '0x' + '0'.repeat(64);
const price = encodeSqrtRatioX96(1, 1);
const conversions = getTokenizePairs(config.chainId).map(
  (p) => new Pool(...p, price, '1000000', 0)
);
const pool = new Pool(
  usdc!.tokenize,
  usdt!.tokenize,
  100,
  1,
  zero,
  price,
  '1000000',
  0
);
const route = new V4Route(
  [conversions[0]!, pool, conversions[1]!],
  usdc!.underlying,
  usdt!.underlying
);
const formatted = `USDC -- 0% [${zeroId}]tUSDC -- 0.01% [${pool.poolId}]tUSDT -- 0% [${zeroId}]USDT`;

describe('CLI route format', () => {
  it('preserves every hop, real pool fee/ID and zero-ID conversions', () => {
    expect(routeToString(route)).toBe(formatted);
    expect(poolToString(conversions[0]!)).toBe(` -- 0% [${zeroId}]`);
  });
  it('keeps real pool IDs for ordinary pools and pools with only one Tokenize', () => {
    for (const token of [usdc!.underlying, usdc!.tokenize]) {
      const real = new Pool(
        token,
        usdt!.underlying,
        500,
        10,
        zero,
        price,
        '1000000',
        0
      );
      expect(poolToString(real)).toBe(` -- 0.05% [${real.poolId}]`);
    }
    const real = new Pool(
      usdc!.underlying,
      usdc!.tokenize,
      100,
      1,
      zero,
      price,
      '1000000',
      0
    );
    expect(poolToString(real)).toBe(` -- 0.01% [${real.poolId}]`);
  });
  it('marks native wrap/unwrap as a conversion but keeps real native-pool IDs', () => {
    const wrap = V4_ETH_WETH_FAKE_POOL[ChainId.BASE_SEPOLIA]!;
    expect(poolToString(wrap)).toBe(` -- 0% [${zeroId}]`);
    const real = new Pool(
      wrap.currency0,
      wrap.currency1,
      500,
      10,
      zero,
      price,
      '1000000',
      0
    );
    expect(poolToString(real)).toBe(` -- 0.05% [${real.poolId}]`);
  });
  it('retains protocol, two-decimal split percentages and comma-separated routes', () => {
    const leg = (amount: number) =>
      ({
        route,
        protocol: Protocol.V4,
        amount: CurrencyAmount.fromRawAmount(usdc!.underlying, amount),
      } as RouteWithValidQuote);
    expect(routeAmountsToString([leg(100)])).toBe(
      `[V4] 100.00% = ${formatted}`
    );
    expect(routeAmountsToString([leg(95), leg(5)])).toBe(
      `[V4] 95.00% = ${formatted}, [V4] 5.00% = ${formatted}`
    );
    expect(routeAmountsToString([])).toBe('');
  });
});
