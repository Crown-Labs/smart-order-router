import { Protocol } from '@kittycorn-labs/router-sdk';
import { ChainId, Percent, TradeType } from '@kittycorn-labs/sdk-core';
import { KITTYCORN_BASE_SEPOLIA as config } from '@kittycorn-labs/v4-sdk';
import {
  AlphaRouter,
  AlphaRouterConfig,
  CurrencyAmount,
  ID_TO_PROVIDER,
  SwapType,
} from '../../../src';

const options = {
  type: SwapType.KITTYCORN as const,
  recipient: '0x0000000000000000000000000000000000001234',
  slippageTolerance: new Percent(1, 100),
};

describe('Kittycorn discovery configuration', () => {
  const properties = jest.fn().mockRejectedValue(new Error('RPC boundary'));
  const router = Object.assign(Object.create(AlphaRouter.prototype), {
    chainId: config.chainId,
    tokenPropertiesProvider: { getTokensProperties: properties },
  }) as AlphaRouter;
  const route = (routing: Partial<AlphaRouterConfig>) =>
    router.route(
      CurrencyAmount.fromRawAmount(config.tokens[0]!.underlying, '1000000'),
      config.tokens[1]!.underlying,
      TradeType.EXACT_INPUT,
      options,
      routing
    );
  beforeEach(() => properties.mockClear());

  test.each([undefined, [], [Protocol.V4]])(
    'defaults to executable V4 discovery for %p',
    async (protocols) => {
      const routing = { protocols };
      await expect(route(routing)).rejects.toThrow('RPC boundary');
      expect(properties).toHaveBeenCalledWith(expect.any(Array), {
        protocols: [Protocol.V4],
      });
      expect(routing.protocols).toBe(protocols); // Do not mutate the caller's config.
    }
  );
  test.each([[Protocol.V3], [Protocol.V4, Protocol.V2], [Protocol.MIXED]])(
    'rejects unsupported protocol set %p before RPC',
    async (...protocols) => {
      await expect(route({ protocols })).rejects.toThrow(
        'Kittycorn requires V4'
      );
      expect(properties).not.toHaveBeenCalled();
    }
  );
});

describe('Base Sepolia RPC aliases', () => {
  const keys = [
    'JSON_RPC_PROVIDER_BASE_SEPOLIA',
    'RPC_BASE_SEPOLIA_FORK_URL',
  ] as const;
  const saved = keys.map((key) => process.env[key]);
  afterEach(() =>
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    })
  );
  it('uses the contracts alias and gives the SOR setting precedence', () => {
    delete process.env.JSON_RPC_PROVIDER_BASE_SEPOLIA;
    process.env.RPC_BASE_SEPOLIA_FORK_URL = 'http://localhost:18546';
    expect(ID_TO_PROVIDER(ChainId.BASE_SEPOLIA)).toBe('http://localhost:18546');
    process.env.JSON_RPC_PROVIDER_BASE_SEPOLIA = 'http://localhost:18547';
    expect(ID_TO_PROVIDER(ChainId.BASE_SEPOLIA)).toBe('http://localhost:18547');
  });
});
