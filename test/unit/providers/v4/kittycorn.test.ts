import { Ether } from '@kittycorn-labs/sdk-core';
import { routeToString } from '../../../../src/util/routes';
import { BigNumber } from '@ethersproject/bignumber';
import { encodeSqrtRatioX96, TickMath } from '@kittycorn-labs/v3-sdk';
import {
  isTokenizeConversion,
  KITTYCORN_BASE_SEPOLIA as config,
  Pool,
} from '@kittycorn-labs/v4-sdk';
import NodeCache from 'node-cache';
import { NodeJSCache } from '../../../../src/providers/cache-node';
import { IMulticallProvider } from '../../../../src/providers/multicall-provider';
import { CachingV4PoolProvider } from '../../../../src/providers/v4/caching-pool-provider';
import { V4PoolProvider } from '../../../../src/providers/v4/pool-provider';
import { computeAllV4Routes } from '../../../../src/routers/alpha-router/functions/compute-all-routes';

function setup() {
  const call = jest.fn(async ({ address }) => {
    const pair = config.tokens.find((t) => t.tokenize.address === address)!;
    return {
      results: [
        BigNumber.from(199),
        BigNumber.from(99),
        pair.underlying.address,
        config.bank,
      ].map((value) => ({ success: true, result: [value] })),
    };
  });
  const provider = new V4PoolProvider(84532, {
    callMultipleFunctionsOnSameContract: call,
    callSameFunctionOnContractWithMultipleParams: jest.fn(async () => ({
      results: [],
      blockNumber: 100,
    })),
  } as unknown as IMulticallProvider);
  return { call, provider };
}

describe('Kittycorn ERC4626 routing', () => {
  it('uses virtual assets/shares and the correct direction, without changing real pool identities', async () => {
    const { provider, call } = setup();
    const pools = await provider.getPools([], { blockNumber: 100 });
    expect(pools.getAllPools()).toHaveLength(3);
    for (const pair of config.tokens) {
      const pool = pools
        .getAllPools()
        .find((p) => p.involvesToken(pair.tokenize))!;
      expect(isTokenizeConversion(pool)).toBe(true);
      expect(pool.priceOf(pair.underlying).toSignificant(4)).toBe('0.5');
      expect(pool.priceOf(pair.tokenize).toSignificant(4)).toBe('2');
    }
    expect(
      call.mock.calls.every(([args]) => args.providerConfig.blockNumber === 100)
    ).toBe(true);
  });

  it('rejects unreadable reserves and mismatched registration', async () => {
    const { provider, call } = setup();
    call.mockResolvedValueOnce({
      results: [{ success: false, result: [] }],
    } as any);
    await expect(provider.getPools([])).rejects.toThrow('Cannot read');
    call.mockImplementation(async () => ({
      results: [
        BigNumber.from(0),
        BigNumber.from(0),
        config.bank,
        config.bank,
      ].map((value) => ({ success: true, result: [value] })),
    }));
    await expect(provider.getPools([])).rejects.toThrow(
      'registration mismatch'
    );
  });

  it('does not reuse latest rates, but caches a pinned block separately', async () => {
    const { provider, call } = setup();
    const cached = new CachingV4PoolProvider(
      84532,
      provider,
      new NodeJSCache<Pool>(new NodeCache({ useClones: false }))
    );
    await cached.getPools([]);
    await cached.getPools([]);
    expect(call).toHaveBeenCalledTimes(6);
    await cached.getPools([], { blockNumber: 100 });
    await cached.getPools([], { blockNumber: 100 });
    expect(call).toHaveBeenCalledTimes(9);
    await cached.getPools([], { blockNumber: 101 });
    expect(call).toHaveBeenCalledTimes(12);
  });

  it('counts real swaps, allows endpoint conversions, and prevents internal conversions/cycles', async () => {
    const { provider } = setup();
    const conversions = (await provider.getPools([])).getAllPools();
    const [usdc, usdt, weth] = config.tokens;
    const price = encodeSqrtRatioX96(1, 1);
    const pool = (a: typeof usdc, b: typeof usdc) =>
      new Pool(
        a!.tokenize,
        b!.tokenize,
        500,
        10,
        '0x0000000000000000000000000000000000000000',
        price,
        '1000000000',
        TickMath.getTickAtSqrtRatio(price)
      );
    const pools = [
      ...conversions,
      pool(usdc, usdt),
      pool(usdc, weth),
      pool(weth, usdt),
    ];
    const one = computeAllV4Routes(
      usdc!.underlying,
      usdt!.underlying,
      pools,
      1
    );
    const eth = Ether.onChain(84532);
    for (const [input, output] of [
      [eth, usdc!.underlying],
      [usdc!.underlying, eth],
    ]) {
      const native = computeAllV4Routes(input!, output!, pools, 1);
      expect(native).toHaveLength(1);
      expect(native[0]!.input).toBe(input);
      expect(native[0]!.output).toBe(output);
      expect(
        native[0]!.currencyPath.every((currency) => currency.isToken)
      ).toBe(true);
      expect(routeToString(native[0]!)).toContain(
        input!.isNative ? 'ETH → WETH' : 'WETH → ETH'
      );
    }
    expect(one).toHaveLength(1);
    expect(one[0]!.pools).toHaveLength(3);
    const two = computeAllV4Routes(
      usdc!.underlying,
      usdt!.underlying,
      pools,
      2
    );
    expect(two).toHaveLength(2);
    expect(
      two.every((r) =>
        r.pools.slice(1, -1).every((p) => !isTokenizeConversion(p))
      )
    ).toBe(true);
  });
});
