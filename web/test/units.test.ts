import { BaseError, ContractFunctionRevertedError, RpcRequestError, UserRejectedRequestError, type AbiEvent, type EIP1193Provider, type PublicClient } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { isUnknownChainError, switchOrAddChain } from '../src/chainSwitch';
import { epochAt, epochEndsAt, previewNextBudget, shareOf } from '../src/epoch';
import { describeError } from '../src/errors';
import { formatAmount, formatDuration, parseAmount, shortAddress } from '../src/format';
import { getLogsChunked } from '../src/logs';
import { networkFile } from './harness';

describe('amount formatting and parsing', () => {
  it('formats minor units without floating point', () => {
    expect(formatAmount(100_000n * 10n ** 18n, 18)).toBe('100,000');
    expect(formatAmount(1_234_567_890_123_456_789n, 18)).toBe('1.2345…');
    expect(formatAmount(0n, 18)).toBe('0');
    expect(formatAmount(1n, 18)).toBe('0…');
    expect(formatAmount(25n * 10n ** 17n, 18)).toBe('2.5');
  });
  it('parses decimal input and rejects junk', () => {
    expect(parseAmount('1000', 18)).toBe(1000n * 10n ** 18n);
    expect(parseAmount('1,000.5', 18)).toBe(10005n * 10n ** 17n);
    expect(parseAmount('0', 18)).toBeNull();
    expect(parseAmount('abc', 18)).toBeNull();
    expect(parseAmount('1.0000000000000000001', 18)).toBeNull();
    expect(parseAmount('', 18)).toBeNull();
  });
  it('formats durations and addresses', () => {
    expect(formatDuration(59)).toBe('00:00:59');
    expect(formatDuration(3661)).toBe('01:01:01');
    expect(formatDuration(90_000)).toBe('1d 01:00:00');
    expect(shortAddress('0x6113b02eefeea3feffb1d3ede7ad2020d5b4d0bd')).toBe('0x6113…d0bd');
  });
});

describe('epoch arithmetic', () => {
  it('mirrors the contract', () => {
    expect(epochAt(1000n, 1000n, 86_400n)).toBe(0n);
    expect(epochAt(1000n + 86_399n, 1000n, 86_400n)).toBe(0n);
    expect(epochAt(1000n + 86_400n, 1000n, 86_400n)).toBe(1n);
    expect(epochEndsAt(0n, 1000n, 86_400n)).toBe(87_400n);
    expect(shareOf(10n, 3n)).toBe(3n);
    expect(shareOf(10n, 0n)).toBe(0n);
  });
  it('previews the next budget including the pending refund', () => {
    // README example: gift 70, budget 10 with 3 check-ins -> dust 1 returns, next budget (60 + 1) / 7 = 8
    expect(previewNextBudget({ pool: 60n, lastBudget: 10n, lastCheckIns: 3n, lastFinalised: false, hasBudget: true })).toBe(8n);
    expect(previewNextBudget({ pool: 60n, lastBudget: 10n, lastCheckIns: 0n, lastFinalised: false, hasBudget: true })).toBe(10n);
    expect(previewNextBudget({ pool: 60n, lastBudget: 10n, lastCheckIns: 0n, lastFinalised: true, hasBudget: true })).toBe(8n);
    expect(previewNextBudget({ pool: 0n, lastBudget: 0n, lastCheckIns: 0n, lastFinalised: false, hasBudget: false })).toBe(0n);
  });
});

describe('chain switching', () => {
  const params = networkFile.walletAddChain as never;
  it('switches directly when the wallet knows the chain', async () => {
    const request = vi.fn().mockResolvedValue(null);
    await switchOrAddChain({ request } as unknown as EIP1193Provider, params);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
  });
  it('adds the chain with the vetted parameters after a 4902 and switches again', async () => {
    const calls: string[] = [];
    const request = vi.fn(async ({ method }: { method: string }) => {
      calls.push(method);
      if (method === 'wallet_switchEthereumChain' && calls.filter((c) => c === 'wallet_switchEthereumChain').length === 1) {
        throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
      }
      if (method === 'eth_chainId') return '0x1';
      return null;
    });
    await switchOrAddChain({ request } as unknown as EIP1193Provider, params);
    expect(calls).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'eth_chainId', 'wallet_switchEthereumChain']);
    expect(request.mock.calls[1]![0]).toEqual({ method: 'wallet_addEthereumChain', params: [networkFile.walletAddChain] });
  });
  it('recognises message-only unknown-chain errors and propagates other failures', async () => {
    expect(isUnknownChainError({ code: -32603, message: 'Unrecognized chain ID "0xaa36a7".' })).toBe(true);
    expect(isUnknownChainError({ data: { originalError: { code: 4902 } } })).toBe(true);
    expect(isUnknownChainError({ code: 4001, message: 'User rejected' })).toBe(false);
    const request = vi.fn().mockRejectedValue(Object.assign(new Error('User rejected'), { code: 4001 }));
    await expect(switchOrAddChain({ request } as unknown as EIP1193Provider, params)).rejects.toThrow(/User rejected/);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('chunked log queries', () => {
  const event: AbiEvent = { type: 'event', name: 'EpochRolled', inputs: [] };
  it('halves the block span when the RPC rejects a range and covers every block once', async () => {
    const ranges: [bigint, bigint][] = [];
    const client = {
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        if (toBlock - fromBlock + 1n > 2_000n) throw new Error('range too large');
        ranges.push([fromBlock, toBlock]);
        return [{ blockNumber: fromBlock }];
      }),
    } as unknown as PublicClient;
    const logs = await getLogsChunked(client, { address: '0x0000000000000000000000000000000000000001', event, fromBlock: 100n, toBlock: 8_099n, chunkSize: 8_000n });
    expect(logs).toHaveLength(4);
    expect(ranges).toEqual([
      [100n, 2_099n],
      [2_100n, 4_099n],
      [4_100n, 6_099n],
      [6_100n, 8_099n],
    ]);
  });
  it('gives up when the minimum chunk still fails', async () => {
    const client = { getLogs: vi.fn().mockRejectedValue(new Error('down')) } as unknown as PublicClient;
    await expect(getLogsChunked(client, { address: '0x0000000000000000000000000000000000000001', event, fromBlock: 0n, toBlock: 10n, chunkSize: 4n, minChunk: 2n })).rejects.toThrow('down');
  });
});

describe('error descriptions', () => {
  it('explains user rejection, custom reverts and generic failures', () => {
    expect(describeError(new UserRejectedRequestError(new Error('nope'))).kind).toBe('rejected');
    const reverted = new ContractFunctionRevertedError({ abi: [{ type: 'error', name: 'AlreadyCheckedIn', inputs: [] }], functionName: 'checkIn', data: '0x1c76e3ff' });
    const wrapped = new BaseError('call failed', { cause: reverted });
    const described = describeError(wrapped);
    expect(described.kind).toBe('reverted');
    expect(described.message).toMatch(/unknown reason|already checked in/i);
    expect(describeError(new RpcRequestError({ body: {}, url: 'x', error: { code: -32000, message: 'boom' } })).kind).toBe('failed');
    expect(describeError({ code: 4001 }).kind).toBe('rejected');
    expect(describeError(new Error('plain')).message).toContain('plain');
  });
});
