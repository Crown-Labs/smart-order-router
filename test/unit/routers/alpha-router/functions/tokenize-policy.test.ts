import { CurrencyAmount, TradeType } from '@kittycorn-labs/sdk-core';
import { encodeSqrtRatioX96 } from '@kittycorn-labs/v3-sdk';
import {
  getTokenizePairs,
  KITTYCORN_BASE_SEPOLIA as config,
  Pool,
} from '@kittycorn-labs/v4-sdk';
import { BigNumber } from 'ethers';
import { V4Route, V4RouteWithValidQuote } from '../../../../../src';
import { IMulticallProvider } from '../../../../../src/providers/multicall-provider';
import { PortionProvider } from '../../../../../src/providers/portion-provider';
import { V4PoolProvider } from '../../../../../src/providers/v4/pool-provider';
import { DEFAULT_ROUTING_CONFIG_BY_CHAIN } from '../../../../../src/routers/alpha-router/config';
import { getBestSwapRoute } from '../../../../../src/routers/alpha-router/functions/best-swap-route';
import { isTokenizeRoute } from '../../../../../src/util/routes';

const [a, b] = config.tokens;
const price = encodeSqrtRatioX96(1, 1);
const zero = '0x0000000000000000000000000000000000000000';
const conversions = getTokenizePairs(84532).map(
  (p) => new Pool(...p, price, '1000000', 0)
);
const plain = new V4Route(
  [new Pool(a!.underlying, b!.underlying, 100, 1, zero, price, '1000000', 0)],
  a!.underlying,
  b!.underlying
);
const tokenized = new V4Route(
  [
    conversions[0]!,
    new Pool(a!.tokenize, b!.tokenize, 100, 1, zero, price, '1000000', 0),
    conversions[1]!,
  ],
  a!.underlying,
  b!.underlying
);
const provider = new V4PoolProvider(84532, {} as IMulticallProvider);

async function select(
  type: TradeType,
  lossBps = 50,
  minPercent = 5,
  available = true,
  penalty = 20,
  maxSplits = 2,
  splitGas = 0
) {
  const specified =
    type === TradeType.EXACT_INPUT ? a!.underlying : b!.underlying;
  const quoteToken =
    type === TradeType.EXACT_INPUT ? b!.underlying : a!.underlying;
  const gasModel = {
    estimateGasCost: (route: V4RouteWithValidQuote) => ({
      gasEstimate: BigNumber.from(0),
      gasCostInToken: CurrencyAmount.fromRawAmount(
        quoteToken,
        route.percent < 100 ? splitGas : 0
      ),
      gasCostInUSD: CurrencyAmount.fromRawAmount(a!.underlying, 0),
    }),
  };
  const quotes = [5, 95, 100]
    .map((percent) =>
      (available ? [plain, tokenized] : [plain]).map(
        (route) =>
          new V4RouteWithValidQuote({
            route,
            percent,
            amount: CurrencyAmount.fromRawAmount(specified, percent * 100),
            rawQuote: BigNumber.from(
              percent * 100 +
                (route === tokenized
                  ? ((type === TradeType.EXACT_INPUT ? -penalty : penalty) *
                      percent) /
                    5
                  : 0)
            ),
            quoteToken,
            tradeType: type,
            sqrtPriceX96AfterList: [],
            initializedTicksCrossedList: [],
            quoterGasEstimate: BigNumber.from(0),
            gasModel,
            v4PoolProvider: provider,
          })
      )
    )
    .reduce((all, quotes) => all.concat(quotes), []);
  const before = quotes.map((q) => q.percent);
  const result = await getBestSwapRoute(
    CurrencyAmount.fromRawAmount(specified, 10000),
    [5, 95, 100],
    quotes,
    type,
    84532,
    {
      ...DEFAULT_ROUTING_CONFIG_BY_CHAIN(84532),
      maxSplits,
      tokenizeRoutePercent: minPercent,
      maxTokenizeQuoteLossBps: lossBps,
    },
    new PortionProvider()
  );
  expect(quotes.map((q) => q.percent)).toEqual(before);
  return result!;
}

describe('Tokenize bootstrap volume policy', () => {
  test.each([TradeType.EXACT_INPUT, TradeType.EXACT_OUTPUT])(
    'selects a slightly worse fee-earning route within budget (%s)',
    async (type) => {
      const result = await select(type);
      expect(result.routes.some((r) => isTokenizeRoute(r.route))).toBe(true);
      expect(
        result.routes
          .filter((r) => isTokenizeRoute(r.route))
          .reduce((sum, r) => sum + r.percent, 0)
      ).toBe(5);
      expect(result.routes.reduce((sum, r) => sum + r.percent, 0)).toBe(100);
    }
  );
  test.each([TradeType.EXACT_INPUT, TradeType.EXACT_OUTPUT])(
    'falls back to best price when degradation exceeds budget (%s)',
    async (type) => {
      const result = await select(type, 0);
      expect(result.routes).toHaveLength(1);
      expect(isTokenizeRoute(result.routes[0]!.route)).toBe(false);
    }
  );
  test('can be disabled and handles missing Tokenize quotes', async () => {
    expect((await select(TradeType.EXACT_INPUT, 50, 0)).routes[0]!.route).toBe(
      plain
    );
    expect(
      (await select(TradeType.EXACT_INPUT, 50, 5, false)).routes[0]!.route
    ).toBe(plain);
  });
  test('does not require splits if the best route already earns Tokenize fees', async () => {
    const result = await select(TradeType.EXACT_INPUT, 50, 5, true, -20, 1);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]!.route).toBe(tokenized);
  });
  test('searches within the raw-price budget even when another candidate has cheaper gas', async () => {
    const result = await select(TradeType.EXACT_INPUT, 50, 5, true, 20, 2, 500);
    expect(
      result.routes
        .filter((r) => isTokenizeRoute(r.route))
        .reduce((sum, r) => sum + r.percent, 0)
    ).toBe(5);
  });
  test('counts real fee-earning pools rather than conversion edges alone', () => {
    expect(isTokenizeRoute(plain)).toBe(false);
    expect(isTokenizeRoute(tokenized)).toBe(true);
  });
});

describe('Tokenize complementary-leg price budget', () => {
  test.each([TradeType.EXACT_INPUT, TradeType.EXACT_OUTPUT])(
    'finds an in-budget split behind two cheaper-gas, out-of-budget candidates (%s)',
    async (type) => {
      const exactIn = type === TradeType.EXACT_INPUT;
      const specified = exactIn ? a!.underlying : b!.underlying;
      const quoteToken = exactIn ? b!.underlying : a!.underlying;
      const rows: [V4Route, number, number, number][] = [
        [plain, 100, 10000, 0],
        [plain, 95, 9500, 0],
        ...[100, 500, 3000].map(
          (fee, index): [V4Route, number, number, number] => [
            new V4Route(
              [
                conversions[0]!,
                new Pool(
                  a!.tokenize,
                  b!.tokenize,
                  fee,
                  fee === 100 ? 1 : fee === 500 ? 10 : 60,
                  zero,
                  price,
                  '1000000',
                  0
                ),
                conversions[1]!,
              ],
              a!.underlying,
              b!.underlying
            ),
            5,
            exactIn ? [400, 410, 480][index]! : [600, 590, 520][index]!,
            index === 2 ? 100 : 0,
          ]
        ),
      ];
      const quotes = rows.map(
        ([route, percent, rawQuote, gas]) =>
          new V4RouteWithValidQuote({
            route,
            percent,
            amount: CurrencyAmount.fromRawAmount(specified, percent * 100),
            rawQuote: BigNumber.from(rawQuote),
            quoteToken,
            tradeType: type,
            sqrtPriceX96AfterList: [],
            initializedTicksCrossedList: [],
            quoterGasEstimate: BigNumber.from(0),
            gasModel: {
              estimateGasCost: () => ({
                gasEstimate: BigNumber.from(0),
                gasCostInToken: CurrencyAmount.fromRawAmount(quoteToken, gas),
                gasCostInUSD: CurrencyAmount.fromRawAmount(a!.underlying, 0),
              }),
            },
            v4PoolProvider: provider,
          })
      );
      const result = await getBestSwapRoute(
        CurrencyAmount.fromRawAmount(specified, 10000),
        [5, 95, 100],
        quotes,
        type,
        84532,
        { ...DEFAULT_ROUTING_CONFIG_BY_CHAIN(84532), maxSplits: 2 },
        new PortionProvider()
      );
      expect(result!.routes).toHaveLength(2);
      expect(result!.routes.find((r) => r.percent === 5)!.route).toBe(
        rows[4]![0]
      );
      expect(result!.quote.quotient.toString()).toBe(
        exactIn ? '9980' : '10020'
      );
    }
  );
});
