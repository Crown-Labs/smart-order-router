import { Protocol } from '@kittycorn-labs/router-sdk';
import { CurrencyAmount, Percent, TradeType } from '@kittycorn-labs/sdk-core';
import { buildKittycornUniversalMethodParameters } from '@kittycorn-labs/universal-router-sdk';
import { KITTYCORN_BASE_SEPOLIA as config } from '@kittycorn-labs/v4-sdk';
import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import {
  BigNumber,
  constants,
  Contract,
  ContractFactory,
  providers,
  utils,
} from 'ethers';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  AlphaRouter,
  isTokenizeRoute,
  MethodParameters,
  SwapType,
} from '../src';

/** Execute packaged SDK calldata on an explicitly local Anvil fork. No keys or public transactions. */
async function main() {
  const rpc = process.env.ANVIL_RPC_URL || 'http://127.0.0.1:18546';
  const url = new URL(rpc);
  assert(
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    'Local Anvil URL required'
  );
  const provider = new providers.JsonRpcProvider(rpc, 84532);
  assert(
    (await provider.send('web3_clientVersion', []))
      .toLowerCase()
      .includes('anvil'),
    'Anvil required'
  );
  assert.equal((await provider.getNetwork()).chainId, 84532);
  const account = '0xfff0BF131DAEa9bA4e97829D2d3043aaef3213ff';
  const original = await provider.send('evm_snapshot', []);
  try {
    await provider.send('anvil_impersonateAccount', [account]);
    await provider.send('anvil_setBalance', [
      account,
      utils.parseEther('10').toHexString(),
    ]);
    const signer = provider.getSigner(account);
    const artifact = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../universal-router/out/KittycornUniversalRouter.sol/KittycornUniversalRouter.json'
        ),
        'utf8'
      )
    );
    assert(
      (artifact.deployedBytecode.object.length - 2) / 2 <= 24576,
      'EIP-170 contract size'
    );
    const permit2Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    const universal = await new ContractFactory(
      artifact.abi,
      artifact.bytecode.object,
      signer
    ).deploy(
      {
        permit2: permit2Address,
        weth9: config.tokens[2]!.underlying.address,
        v2Factory: '0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e',
        v3Factory: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
        pairInitCodeHash:
          '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
        poolInitCodeHash:
          '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54',
        v4PoolManager: '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408',
        permissionsAdapterFactory: constants.AddressZero,
        v3NFTPositionManager: '0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2',
        v4PositionManager: '0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80',
        spokePool: constants.AddressZero,
      },
      config.router,
      { gasLimit: 12000000 }
    );
    await universal.deployed();
    console.log('LOCAL Universal Router:', universal.address);
    execFileSync(
      'make',
      [
        'deploy-check',
        'chain=base-sepolia',
        'rpc=' + rpc,
        'router=' + universal.address,
      ],
      { cwd: resolve(__dirname, '../../universal-router'), stdio: 'inherit' }
    );
    const abi = [
      'function approve(address,uint256) returns (bool)',
      'function balanceOf(address) view returns(uint256)',
      'function allowance(address,address) view returns(uint256)',
    ];
    const permit2 = new Contract(
      permit2Address,
      ['function approve(address,address,uint160,uint48)'],
      signer
    );
    for (const { underlying } of config.tokens) {
      const token = new Contract(underlying.address, abi, signer);
      await (await token.approve(config.router, constants.MaxUint256)).wait();
      await (await token.approve(permit2Address, constants.MaxUint256)).wait();
      await (
        await permit2.approve(
          underlying.address,
          universal.address,
          BigNumber.from(2).pow(160).sub(1),
          2 ** 48 - 1
        )
      ).wait();
    }
    const options = {
      type: SwapType.KITTYCORN as const,
      recipient: account,
      slippageTolerance: new Percent(1, 100),
    };
    let count = 0;
    for (const input of config.tokens)
      for (const output of config.tokens) {
        if (
          input === output ||
          (process.env.CHECK_INPUT &&
            input.underlying.symbol !== process.env.CHECK_INPUT)
        )
          continue;
        for (const tradeType of [
          TradeType.EXACT_INPUT,
          TradeType.EXACT_OUTPUT,
        ]) {
          const specified =
            tradeType === TradeType.EXACT_INPUT ? input : output;
          const raw =
            specified.underlying.decimals === 18
              ? '100000000000000'
              : '1000000';
          const blockNumber = await provider.getBlockNumber();
          const router = new AlphaRouter({ chainId: 84532, provider });
          const result = await router.route(
            CurrencyAmount.fromRawAmount(specified.underlying, raw),
            tradeType === TradeType.EXACT_INPUT
              ? output.underlying
              : input.underlying,
            tradeType,
            options,
            {
              blockNumber,
              protocols: [Protocol.V4],
              maxSwapsPerPath: 2,
              maxSplits: 2,
              distributionPercent: 50,
              maxTokenizeQuoteLossBps: Number(
                process.env.CHECK_MAX_QUOTE_LOSS_BPS ?? 50
              ),
            }
          );
          assert(
            result?.methodParameters,
            `No route: ${input.underlying.symbol}/${output.underlying.symbol}`
          );
          if (process.env.CHECK_REQUIRE_TOKENIZE === 'true')
            assert(
              result.route.some((r) => isTokenizeRoute(r.route)),
              'Expected fee-earning Tokenize route'
            );
          const tokenIn = new Contract(input.underlying.address, abi, provider);
          const tokenOut = new Contract(
            output.underlying.address,
            abi,
            provider
          );
          for (const executor of ['direct', 'universal']) {
            const snapshot = await provider.send('evm_snapshot', []);
            try {
              const beforeIn = await tokenIn.balanceOf(account),
                beforeOut = await tokenOut.balanceOf(account);
              const params: MethodParameters =
                executor === 'direct'
                  ? result.methodParameters
                  : buildKittycornUniversalMethodParameters(
                      result.trade,
                      {
                        ...options,
                        universalRouter: universal.address,
                        deadline:
                          (await provider.getBlock('latest')).timestamp + 600,
                      },
                      84532
                    );
              const hash: string = await signer.sendUncheckedTransaction({
                to: params.to,
                data: params.calldata,
                value: params.value,
                gasLimit: 12000000,
              });
              let receipt: { status: string } | null = null;
              for (let attempt = 0; attempt < 300 && !receipt; attempt++) {
                receipt = await provider.send('eth_getTransactionReceipt', [
                  hash,
                ]);
                if (!receipt)
                  await new Promise((resolve) => setTimeout(resolve, 100));
              }
              assert.equal(receipt?.status, '0x1', 'Swap reverted: ' + hash);
              const paid = beforeIn.sub(await tokenIn.balanceOf(account));
              const received = (await tokenOut.balanceOf(account)).sub(
                beforeOut
              );
              assert(paid.gt(0) && received.gt(0), 'Zero economic swap');
              assert(
                paid.lte(
                  result.trade
                    .maximumAmountIn(options.slippageTolerance)
                    .quotient.toString()
                ),
                'Input budget exceeded'
              );
              assert(
                received.gte(
                  result.trade
                    .minimumAmountOut(options.slippageTolerance)
                    .quotient.toString()
                ),
                'Output limit violated'
              );
              assert(
                (
                  await tokenIn.allowance(universal.address, config.router)
                ).isZero(),
                'Residual router approval'
              );
              console.log(
                'PASS',
                executor,
                TradeType[tradeType],
                input.underlying.symbol,
                '->',
                output.underlying.symbol,
                'paid:',
                paid.toString(),
                'received:',
                received.toString(),
                'splits:',
                result.route.length,
                'Tokenize %:',
                result.route
                  .filter((r) => isTokenizeRoute(r.route))
                  .reduce((sum, r) => sum + r.percent, 0)
              );
              count++;
            } finally {
              assert(await provider.send('evm_revert', [snapshot]));
            }
          }
        }
      }
    console.log('PASS', count, 'local executions; restoring fork state');
  } finally {
    await provider.send('anvil_stopImpersonatingAccount', [account]);
    assert(await provider.send('evm_revert', [original]));
  }
}
main().catch((error) => {
  console.error('Fork check failed:', error.message);
  process.exitCode = 1;
});
