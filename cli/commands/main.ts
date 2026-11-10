import { JsonRpcProvider } from '@ethersproject/providers';
import { Protocol } from '@kittycorn-labs/router-sdk';
import {
  Currency,
  CurrencyAmount,
  Percent,
  Token,
  TradeType,
} from '@kittycorn-labs/sdk-core';
import { UniversalRouterVersion } from '@kittycorn-labs/universal-router-sdk';
import DEFAULT_TOKEN_LIST from '@uniswap/default-token-list';
import dotenv from 'dotenv';
import JSBI from 'jsbi';
import NodeCache from 'node-cache';
import {
  AlphaRouter,
  AlphaRouterConfig,
  CachingGasStationProvider,
  CachingTokenListProvider,
  CachingTokenProviderWithFallback,
  EIP1559GasPriceProvider,
  GasPrice,
  ID_TO_CHAIN_ID,
  LegacyGasPriceProvider,
  nativeOnChain,
  NodeJSCache,
  OnChainGasPriceProvider,
  SwapType,
  TokenProvider,
  UniswapMulticallProvider,
} from '../../src';
import { DEFAULT_ROUTING_CONFIG_BY_CHAIN } from '../../src/routers/alpha-router/config';
import {
  NATIVE_NAMES_BY_ID,
  routeAmountsToString,
  TO_PROTOCOL,
} from '../../src/util';

dotenv.config();
const RPC_URL: { [key: number]: string } = {
  1: `${process.env.JSON_RPC_PROVIDER}`,
  56: `${process.env.JSON_RPC_PROVIDER_BNB}`,
  42161: `${process.env.JSON_RPC_PROVIDER_ARBITRUM_ONE}`,
  11155111: `${process.env.JSON_RPC_PROVIDER_SEPOLIA}`,
};

async function main() {
  const payload = {
    amount: '1000000000',
    gasStrategies: [
      {
        limitInflationFactor: 1.15,
        displayLimitInflationFactor: 1.15,
        priceInflationFactor: 1.5,
        percentileThresholdFor1559Fee: 75,
        minPriorityFeeGwei: 2,
        maxPriorityFeeGwei: 9,
      },
    ],
    swapper: '0xAAAA44272dc658575Ba38f43C438447dDED45358',
    tokenIn: '0x0000000000000000000000000000000000000000',
    tokenInChainId: 42161,
    tokenOut: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    tokenOutChainId: 42161,
    type: 'EXACT_OUTPUT',
    urgency: 'normal',
    protocols: ['V3', 'V4'],
  };

  const swapRoutes = await getQuote(payload);

  if (swapRoutes) {
    const { quoteGasAdjusted, route: routeAmounts, trade } = swapRoutes;

    const routeString = routeAmountsToString(routeAmounts);
    console.log('routeString:', routeString);

    const currencyIn = trade.inputAmount.currency;
    const currencyOut = trade.outputAmount.currency;
    console.log('currencyIn:', currencyIn.symbol);
    console.log('currencyOut:', currencyOut.symbol);
    console.log('inputAmount:', trade.inputAmount.toExact());
    console.log('outputAmount:', trade.outputAmount.toExact());
    console.log('quoteGasAdjusted:', quoteGasAdjusted.toExact());
  } else {
    console.log('No swap routes found');
  }
}

async function getQuote(payload: any) {
  const chainId = ID_TO_CHAIN_ID(payload.tokenInChainId);
  const tradeType =
    payload.type === 'EXACT_OUTPUT'
      ? TradeType.EXACT_OUTPUT
      : TradeType.EXACT_INPUT;
  const tokenInAddress = payload.tokenIn;
  const tokenOutAddress = payload.tokenOut;
  const amountRaw = payload.amount;
  const protocolsStr = payload.protocols;

  const rpcUrl = RPC_URL[Number(payload.tokenInChainId)];
  if (!rpcUrl) {
    throw new Error(
      `RPC URL not defined for chainId ${payload.tokenInChainId}`
    );
  }

  const provider = new JsonRpcProvider(rpcUrl, chainId);
  const blockNumber = await provider.getBlockNumber();

  const tokenCache = new NodeJSCache<Token>(
    new NodeCache({ stdTTL: 3600, useClones: false })
  );

  const tokenListProvider = await CachingTokenListProvider.fromTokenList(
    chainId,
    DEFAULT_TOKEN_LIST, // or custom tokenListURI
    tokenCache
  );

  const multicall2Provider = new UniswapMulticallProvider(chainId, provider);

  const tokenProviderOnChain = new TokenProvider(chainId, multicall2Provider);
  const tokenProvider = new CachingTokenProviderWithFallback(
    chainId,
    tokenCache,
    tokenListProvider,
    tokenProviderOnChain
  );

  const currencyIn: Currency = NATIVE_NAMES_BY_ID[chainId]!.includes(
    tokenInAddress.replace(
      '0x0000000000000000000000000000000000000000',
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    )
  )
    ? nativeOnChain(chainId)
    : (await tokenProvider.getTokens([tokenInAddress])).getTokenByAddress(
        tokenInAddress
      )!;

  const currencyOut: Currency = NATIVE_NAMES_BY_ID[chainId]!.includes(
    tokenOutAddress.replace(
      '0x0000000000000000000000000000000000000000',
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    )
  )
    ? nativeOnChain(chainId)
    : (await tokenProvider.getTokens([tokenOutAddress])).getTokenByAddress(
        tokenOutAddress
      )!;

  let protocols: Protocol[] = [];
  if (protocolsStr) {
    protocols = protocolsStr.map((version: string) => TO_PROTOCOL(version));
  }

  const gasPriceCache = new NodeJSCache<GasPrice>(
    new NodeCache({ stdTTL: 15, useClones: true })
  );

  const router = new AlphaRouter({
    provider,
    chainId,
    multicall2Provider: multicall2Provider,
    gasPriceProvider: new CachingGasStationProvider(
      chainId,
      new OnChainGasPriceProvider(
        chainId,
        new EIP1559GasPriceProvider(provider),
        new LegacyGasPriceProvider(provider)
      ),
      gasPriceCache
    ),
  });

  const routingConfig: AlphaRouterConfig = {
    ...DEFAULT_ROUTING_CONFIG_BY_CHAIN(chainId),
    ...{
      blockNumber: blockNumber,
      protocols,
      v2PoolSelection: {
        topN: 3,
        topNDirectSwaps: 1,
        topNTokenInOut: 5,
        topNSecondHop: 2,
        topNWithEachBaseToken: 2,
        topNWithBaseToken: 6,
      },
      v3PoolSelection: {
        topN: 2,
        topNDirectSwaps: 2,
        topNTokenInOut: 2,
        topNSecondHop: 1,
        topNWithEachBaseToken: 3,
        topNWithBaseToken: 2,
      },
      v4PoolSelection: {
        topN: 2,
        topNDirectSwaps: 2,
        topNTokenInOut: 2,
        topNSecondHop: 1,
        topNWithEachBaseToken: 3,
        topNWithBaseToken: 2,
      },
      maxSwapsPerPath: 2,
      minSplits: 1,
      maxSplits: 7,
      distributionPercent: 25,
      forceCrossProtocol: false,
    },
  };

  const recipient = undefined;

  if (tradeType === TradeType.EXACT_INPUT) {
    const amount = CurrencyAmount.fromRawAmount(
      currencyIn,
      JSBI.BigInt(amountRaw)
    );

    const swapRoute = await router.route(
      amount,
      currencyOut,
      tradeType,
      recipient
        ? {
            type: SwapType.UNIVERSAL_ROUTER,
            deadlineOrPreviousBlockhash: 10000000000000,
            recipient,
            slippageTolerance: new Percent(5, 100),
            simulate: undefined, // simulate ? { fromAddress: recipient } : undefined,
            version: UniversalRouterVersion.V2_0,
          }
        : undefined,
      routingConfig
    );
    return swapRoute;
  } else {
    const amount = CurrencyAmount.fromRawAmount(
      currencyOut,
      JSBI.BigInt(amountRaw)
    );

    const swapRoute = await router.route(
      amount,
      currencyIn,
      tradeType,
      recipient
        ? {
            type: SwapType.SWAP_ROUTER_02,
            deadline: 100,
            recipient,
            slippageTolerance: new Percent(5, 10_000),
          }
        : undefined,
      routingConfig
    );
    return swapRoute;
  }
}

if (process.env.DEVELOP === 'true') {
  main().catch((error) => {
    console.error('Error:', error);
  });
}
