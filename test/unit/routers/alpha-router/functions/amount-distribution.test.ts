import { KITTYCORN_BASE_SEPOLIA as config } from '@kittycorn-labs/v4-sdk';
import {
  AlphaRouter,
  AlphaRouterConfig,
  CurrencyAmount,
} from '../../../../../src';

// Exercise distribution without provider/RPC setup: it depends only on chain and routing config.
const distribute = (
  distributionPercent: number,
  tokenizeRoutePercent = 5
): [number[], CurrencyAmount[]] =>
  (AlphaRouter.prototype as any).getAmountDistribution.call(
    { chainId: config.chainId },
    CurrencyAmount.fromRawAmount(config.tokens[0]!.underlying, '1000000'),
    { distributionPercent, tokenizeRoutePercent } as AlphaRouterConfig
  );

describe('amount distribution validation', () => {
  test.each([0, -1, Infinity, NaN, 0.5, 101])(
    'rejects invalid distribution %s without looping',
    (value) => {
      expect(() => distribute(value)).toThrow('distributionPercent');
    }
  );
  it('always includes a full-size quote even when the increment does not divide 100', () => {
    const [percent, amounts] = distribute(30, 0);
    expect(percent).toEqual([30, 60, 90, 100]);
    expect(amounts[3]!.quotient.toString()).toBe('1000000');
  });
  it('retains the 5/95 bootstrap split without duplicate full-size quotes', () => {
    expect(distribute(50)[0]).toEqual([5, 50, 95, 100]);
    expect(distribute(100)[0]).toEqual([5, 95, 100]);
  });
});
