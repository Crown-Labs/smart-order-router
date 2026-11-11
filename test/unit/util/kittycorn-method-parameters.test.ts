import { defaultAbiCoder, Interface } from '@ethersproject/abi';
import { Trade } from '@kittycorn-labs/router-sdk';
import {
  CurrencyAmount,
  Ether,
  Percent,
  TradeType,
} from '@kittycorn-labs/sdk-core';
import {
  KITTYCORN_BASE_SEPOLIA as config,
  Pool,
  Route,
} from '@kittycorn-labs/v4-sdk';
import { SwapType } from '../../../src/routers/router';
import { buildSwapMethodParameters } from '../../../src/util/methodParameters';

// Use installed dependencies. Expectations below describe the Solidity wire format,
// not a second call to the same SDK encoder (which would hide regressions).
const zero = '0x0000000000000000000000000000000000000000';
const sender = '0x0000000000000000000000000000000000000001';
const options = {
  type: SwapType.KITTYCORN as const,
  recipient: '0x0000000000000000000000000000000000001234',
  slippageTolerance: new Percent(1, 100),
  universalRouter: '0x02D353c5cA5e316bBd99FAC6a481eB8b778Ea67d',
  deadline: 2000000000,
};
const execute = new Interface(['function execute(bytes,bytes[],uint256)']);
const swapType =
  'tuple(address currency,tuple(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint256[] minHopPriceX36,uint128 amount,uint128 limit)';
const pairTypes = [
  'stable',
  'wrapped',
  'native-input',
  'native-output',
] as const;

for (const pair of pairTypes)
  for (const mode of ['plain', 'tokenize', 'mixed'] as const)
    for (const tradeType of [TradeType.EXACT_INPUT, TradeType.EXACT_OUTPUT]) {
      test(`installed SDK: ${pair}, ${mode}, ${TradeType[tradeType]}`, () => {
        const usdc = config.tokens.find((t) => t.underlying.symbol === 'USDC');
        const usdt = config.tokens.find((t) => t.underlying.symbol === 'USDT');
        const weth = config.tokens.find((t) => t.underlying.symbol === 'WETH');
        if (!usdc || !usdt || !weth)
          throw new Error('Missing Base Sepolia registry entries');
        const nativeIn = pair === 'native-input';
        const nativeOut = pair === 'native-output';
        const a = nativeIn ? weth : usdc;
        const b = pair === 'stable' ? usdt : nativeIn ? usdc : weth;
        const input = nativeIn ? Ether.onChain(config.chainId) : a.underlying;
        const output = nativeOut ? Ether.onChain(config.chainId) : b.underlying;
        const pool = (
          x: typeof a.underlying,
          y: typeof a.underlying,
          fee: number
        ) =>
          new Pool(
            x,
            y,
            fee,
            1,
            zero,
            '79228162514264337593543950336',
            '1000000000000',
            0
          );
        const legs = mode === 'mixed' ? [true, false] : [mode === 'tokenize'];
        const rawIn = BigInt('10000000000000001'); // deliberately above Number.MAX_SAFE_INTEGER
        const rawOut = BigInt('9001');
        const trade = new Trade({
          v4Routes: legs.map((tokenize) => ({
            routev4: new Route(
              tokenize
                ? [
                    pool(a.underlying, a.tokenize, 0),
                    pool(a.tokenize, b.tokenize, 500),
                    pool(b.tokenize, b.underlying, 0),
                  ]
                : [pool(a.underlying, b.underlying, 500)],
              input,
              output
            ),
            inputAmount: CurrencyAmount.fromRawAmount(input, rawIn.toString()),
            outputAmount: CurrencyAmount.fromRawAmount(
              output,
              rawOut.toString()
            ),
          })),
          tradeType,
        });
        const exactOut = tradeType === TradeType.EXACT_OUTPUT;
        const totalIn = rawIn * BigInt(legs.length);
        const totalOut = rawOut * BigInt(legs.length);
        const maximum = exactOut
          ? (totalIn * BigInt(101)) / BigInt(100)
          : totalIn;
        const minimum = exactOut
          ? totalOut
          : (totalOut * BigInt(99)) / BigInt(100);
        const result = buildSwapMethodParameters(
          trade,
          options,
          config.chainId
        );
        const [commands, inputs, deadline] = execute.decodeFunctionData(
          'execute',
          result.calldata
        );
        expect(commands).toBe(
          nativeIn ? '0x0b410c' : nativeOut ? '0x410c' : '0x41'
        );
        expect(result.to).toBe(options.universalRouter);
        expect(deadline.toString()).toBe(String(options.deadline));
        expect(BigInt(result.value)).toBe(nativeIn ? maximum : BigInt(0));
        const [token, budget, payerIsUser, plan] = defaultAbiCoder.decode(
          ['address', 'uint256', 'bool', 'bytes'],
          inputs[nativeIn ? 1 : 0]
        );
        expect(token).toBe(a.underlying.address);
        expect(budget.toString()).toBe(maximum.toString());
        expect(payerIsUser).toBe(!nativeIn);
        const [actions, params] = defaultAbiCoder.decode(
          ['bytes', 'bytes[]'],
          plan
        );
        expect(actions).toBe(
          '0x' +
            (exactOut ? '09' : '07').repeat(legs.length) +
            '0b'.repeat(legs.length) +
            '0e'.repeat(legs.length)
        );
        let limits = BigInt(0);
        legs.forEach((tokenize, i) => {
          const [swap] = defaultAbiCoder.decode([swapType], params[i]);
          expect(swap.currency).toBe(
            exactOut ? b.underlying.address : a.underlying.address
          );
          expect(swap.amount.toString()).toBe(
            (exactOut ? rawOut : rawIn).toString()
          );
          limits += BigInt(swap.limit.toString());
          expect(swap.path.length).toBe(tokenize ? 3 : 1);
          expect(
            swap.path.map(
              (hop: { intermediateCurrency: string }) =>
                hop.intermediateCurrency
            )
          ).toEqual(
            tokenize
              ? exactOut
                ? [a.underlying.address, a.tokenize.address, b.tokenize.address]
                : [a.tokenize.address, b.tokenize.address, b.underlying.address]
              : [exactOut ? a.underlying.address : b.underlying.address]
          );
          const [settleToken, settleAmount, payer] = defaultAbiCoder.decode(
            ['address', 'uint256', 'bool'],
            params[legs.length + i]
          );
          expect(settleToken).toBe(
            tokenize ? a.tokenize.address : a.underlying.address
          );
          expect(settleAmount.toString()).toBe('0');
          expect(payer).toBe(true);
          const [takeToken, recipient] = defaultAbiCoder.decode(
            ['address', 'address', 'uint256'],
            params[2 * legs.length + i]
          );
          expect(takeToken).toBe(
            tokenize ? b.tokenize.address : b.underlying.address
          );
          expect(recipient).toBe(
            nativeOut ? options.universalRouter : options.recipient
          );
        });
        if (exactOut) expect(limits <= maximum).toBe(true);
        else expect(limits).toBe(minimum);
        if (nativeIn) {
          const [recipient, amount] = defaultAbiCoder.decode(
            ['address', 'uint256'],
            inputs[0]
          );
          expect(recipient).toBe(options.universalRouter);
          expect(amount.toString()).toBe(maximum.toString());
        }
        if (nativeIn || nativeOut) {
          const [recipient, amount] = defaultAbiCoder.decode(
            ['address', 'uint256'],
            inputs[inputs.length - 1]
          );
          expect(recipient).toBe(nativeIn ? sender : options.recipient);
          expect(amount.toString()).toBe(nativeIn ? '0' : minimum.toString());
        }
        if (!nativeIn && !nativeOut) {
          const direct = buildSwapMethodParameters(
            trade,
            {
              type: options.type,
              recipient: options.recipient,
              slippageTolerance: options.slippageTolerance,
            },
            config.chainId
          );
          expect(direct.to).toBe(config.router);
          expect(BigInt(direct.value)).toBe(BigInt(0));
          expect(
            new Interface([
              'function executeActions(bytes)',
            ]).decodeFunctionData('executeActions', direct.calldata)[0]
          ).toBe(plan);
        }
      });
    }
