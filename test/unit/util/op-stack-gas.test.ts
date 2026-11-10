import { BigNumber, providers, utils } from 'ethers';
import { ChainId } from '@kittycorn-labs/sdk-core';
import { calculateOptimismToL1FeeFromCalldata } from '../../../src/util/gas-factory-helpers';

describe('OP Stack calldata fees', () => {
  it('uses the canonical oracle and the same unsigned transaction for both estimates', async () => {
    const provider = new providers.StaticJsonRpcProvider(undefined, 84532);
    const abi = new utils.Interface([
      'function getL1GasUsed(bytes) view returns (uint256)',
      'function getL1Fee(bytes) view returns (uint256)',
    ]);
    const seen: string[] = [];
    const call = jest.spyOn(provider, 'call').mockImplementation(async (tx) => {
      expect((await tx.to)?.toLowerCase()).toBe(
        '0x420000000000000000000000000000000000000f'
      );
      const parsed = abi.parseTransaction({ data: (await tx.data) as string });
      seen.push(parsed.args[0]);
      return utils.defaultAbiCoder.encode(
        ['uint256'],
        [parsed.name === 'getL1GasUsed' ? 123 : 456]
      );
    });
    try {
      const result = await calculateOptimismToL1FeeFromCalldata(
        '0x123400',
        84532 as ChainId,
        provider
      );
      expect(result).toEqual([BigNumber.from(123), BigNumber.from(456)]);
      expect(seen).toHaveLength(2);
      expect(seen[0]).toBe(seen[1]);
      const tx = utils.parseTransaction(seen[0]!);
      expect(tx.chainId).toBe(84532);
      expect(tx.type).toBe(2);
      expect(tx.nonce).toBe(0xffffffff);
      expect(tx.data).toBe('0x123400');
    } finally {
      call.mockRestore();
    }
  });
});
