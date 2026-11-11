import { Interface } from '@ethersproject/abi';
import { Trade } from '@kittycorn-labs/router-sdk';
import {
  CurrencyAmount,
  Ether,
  Percent,
  Token,
  TradeType,
} from '@kittycorn-labs/sdk-core';
import {
  KITTYCORN_BASE_SEPOLIA as config,
  Pool,
  Route,
} from '@kittycorn-labs/v4-sdk';
import { SwapType } from '../../../src/routers/router';
import { buildSwapMethodParameters } from '../../../src/util/methodParameters';

// Exercise the installed SDK through SOR so a stale SDK cannot silently enter a release.
for (const nativeIn of [true, false])
  for (const tradeType of [TradeType.EXACT_INPUT, TradeType.EXACT_OUTPUT]) {
    test(`installed SDK encodes native ${nativeIn ? 'input' : 'output'} ${
      TradeType[tradeType]
    }`, () => {
      const usdc = config.tokens.find(
        ({ underlying }) => underlying.symbol === 'USDC'
      );
      const weth = config.tokens.find(
        ({ underlying }) => underlying.symbol === 'WETH'
      );
      if (!usdc || !weth)
        throw new Error('Base Sepolia registry must include USDC and WETH');
      const eth = Ether.onChain(config.chainId);
      const pool = (a: Token, b: Token, fee: number) =>
        new Pool(
          a,
          b,
          fee,
          1,
          '0x0000000000000000000000000000000000000000',
          '79228162514264337593543950336',
          '1000000000000',
          0
        );
      const pools = [
        pool(weth.underlying, weth.tokenize, 0),
        pool(weth.tokenize, usdc.tokenize, 500),
        pool(usdc.tokenize, usdc.underlying, 0),
      ];
      if (!nativeIn) pools.reverse();
      const input = nativeIn ? eth : usdc.underlying,
        output = nativeIn ? usdc.underlying : eth;
      const trade = new Trade({
        v4Routes: [
          {
            routev4: new Route(pools, input, output),
            inputAmount: CurrencyAmount.fromRawAmount(
              input,
              '10000000000000001'
            ),
            outputAmount: CurrencyAmount.fromRawAmount(output, '9000'),
          },
        ],
        tradeType,
      });
      const options = {
        type: SwapType.KITTYCORN as const,
        recipient: '0x0000000000000000000000000000000000001234',
        slippageTolerance: new Percent(1, 100),
        universalRouter: '0x02D353c5cA5e316bBd99FAC6a481eB8b778Ea67d',
        deadline: 2000000000,
      };
      const result = buildSwapMethodParameters(trade, options, config.chainId);
      const [commands] = new Interface([
        'function execute(bytes,bytes[],uint256)',
      ]).decodeFunctionData('execute', result.calldata);
      expect(commands).toBe(nativeIn ? '0x0b410c' : '0x410c');
      expect(result.to).toBe(options.universalRouter);
      expect(BigInt(result.value)).toBe(
        nativeIn
          ? BigInt(
              trade
                .maximumAmountIn(options.slippageTolerance)
                .quotient.toString()
            )
          : BigInt(0)
      );
    });
  }
