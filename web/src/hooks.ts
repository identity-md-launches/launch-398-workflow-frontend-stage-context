import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Abi, Address, ContractFunctionArgs, ContractFunctionName, Hex } from 'viem';
import { useAccount, useBlockNumber, useConfig, usePublicClient } from 'wagmi';
import { simulateContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions';
import type { Deployment } from './deployment';
import { describeError, type ActionError } from './errors';
import { readHistory, readLaunchQuote, readSnapshot, type EpochHistory, type LaunchQuote, type PoolSnapshot } from './reads';

export const SNAPSHOT_KEY = 'snapshot';
export const HISTORY_KEY = 'history';
export const QUOTE_KEY = 'quote';

export function useSnapshot(deployment: Deployment) {
  const client = usePublicClient({ chainId: deployment.chain.id });
  const { address } = useAccount();
  const { data: blockNumber } = useBlockNumber({ chainId: deployment.chain.id, watch: true });
  const query = useQuery<PoolSnapshot, Error>({
    queryKey: [SNAPSHOT_KEY, deployment.pool.address, address ?? null],
    queryFn: () => {
      if (!client) throw new Error('RPC client unavailable');
      return readSnapshot(client, deployment, address);
    },
    enabled: Boolean(client),
    refetchInterval: 30_000,
    staleTime: 5_000,
    retry: 2,
  });
  // Re-read on every new block so balances and epoch state stay live without a wallet round-trip.
  const refetch = query.refetch;
  const lastBlock = useRef<bigint | undefined>(undefined);
  useEffect(() => {
    if (blockNumber === undefined || blockNumber === lastBlock.current) return;
    const first = lastBlock.current === undefined;
    lastBlock.current = blockNumber;
    if (!first) void refetch();
  }, [blockNumber, refetch]);
  return query;
}

export function useHistory(deployment: Deployment, currentEpoch: bigint | undefined) {
  const client = usePublicClient({ chainId: deployment.chain.id });
  const { address } = useAccount();
  return useQuery<EpochHistory, Error>({
    queryKey: [HISTORY_KEY, deployment.pool.address, address ?? null, currentEpoch?.toString() ?? null],
    queryFn: () => {
      if (!client || currentEpoch === undefined) throw new Error('RPC client unavailable');
      return readHistory(client, deployment, currentEpoch, address);
    },
    enabled: Boolean(client) && currentEpoch !== undefined,
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
}

export function useLaunchQuote(deployment: Deployment, tokenAddress: Address | undefined, bond: bigint | undefined) {
  const client = usePublicClient({ chainId: deployment.chain.id });
  return useQuery<LaunchQuote, Error>({
    queryKey: [QUOTE_KEY, deployment.network.uniswapV4.quoter, tokenAddress ?? null, bond?.toString() ?? null],
    queryFn: () => {
      if (!client || !tokenAddress || bond === undefined) throw new Error('RPC client unavailable');
      return readLaunchQuote(client, deployment, tokenAddress, bond);
    },
    enabled: Boolean(client) && Boolean(tokenAddress) && bond !== undefined,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Ticks once per second; used by the countdown. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ---------------------------------------------------------------------------------------------
// One transaction at a time: simulate, ask the wallet, wait for the receipt, refresh reads.

export type ActionPhase = 'idle' | 'simulating' | 'wallet' | 'pending' | 'confirmed' | 'error';

export interface ActionState {
  phase: ActionPhase;
  /** Which control started this action, e.g. "register". */
  key: string | null;
  /** Human description, e.g. "Register worker". */
  label: string;
  hash?: Hex;
  error?: ActionError;
}

export interface RunParams<
  abi extends Abi,
  functionName extends ContractFunctionName<abi, 'nonpayable' | 'payable'>,
  args extends ContractFunctionArgs<abi, 'nonpayable' | 'payable', functionName>,
> {
  key: string;
  label: string;
  address: Address;
  abi: abi;
  functionName: functionName;
  args?: args;
}

const IDLE: ActionState = { phase: 'idle', key: null, label: '' };

export function useAction(deployment: Deployment) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const { address, connector } = useAccount();
  const [state, setState] = useState<ActionState>(IDLE);
  const busy = useRef(false);

  const run = useCallback(
    async <
      const abi extends Abi,
      functionName extends ContractFunctionName<abi, 'nonpayable' | 'payable'>,
      args extends ContractFunctionArgs<abi, 'nonpayable' | 'payable', functionName>,
    >(params: RunParams<abi, functionName, args>): Promise<boolean> => {
      if (busy.current) return false;
      if (!address || !connector) {
        setState({ phase: 'error', key: params.key, label: params.label, error: { kind: 'failed', message: 'Connect a wallet first.' } });
        return false;
      }
      busy.current = true;
      setState({ phase: 'simulating', key: params.key, label: params.label });
      let hash: Hex | undefined;
      try {
        const { request } = await simulateContract(config, {
          address: params.address,
          abi: params.abi as Abi,
          functionName: params.functionName as string,
          args: params.args as readonly unknown[] | undefined,
          account: address,
          chainId: deployment.chain.id,
          connector,
        } as never);
        setState({ phase: 'wallet', key: params.key, label: params.label });
        hash = await writeContract(config, request as never);
        setState({ phase: 'pending', key: params.key, label: params.label, hash });
        const receipt = await waitForTransactionReceipt(config, { hash, chainId: deployment.chain.id, confirmations: 1 });
        if (receipt.status !== 'success') {
          setState({
            phase: 'error',
            key: params.key,
            label: params.label,
            hash,
            error: { kind: 'reverted', message: 'The transaction was mined but reverted. State is unchanged.' },
          });
          return false;
        }
        setState({ phase: 'confirmed', key: params.key, label: params.label, hash });
        return true;
      } catch (error) {
        setState({ phase: 'error', key: params.key, label: params.label, ...(hash ? { hash } : {}), error: describeError(error) });
        return false;
      } finally {
        busy.current = false;
        void queryClient.invalidateQueries({ queryKey: [SNAPSHOT_KEY] });
        void queryClient.invalidateQueries({ queryKey: [HISTORY_KEY] });
      }
    },
    [address, connector, config, deployment.chain.id, queryClient],
  );

  const reset = useCallback(() => setState(IDLE), []);
  const inFlight = state.phase === 'simulating' || state.phase === 'wallet' || state.phase === 'pending';
  return { state, run, reset, inFlight };
}
