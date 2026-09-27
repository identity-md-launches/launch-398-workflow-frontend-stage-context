// Contract reads. Everything the page shows comes from views and events on the configured chain.
import {
  encodeAbiParameters,
  getAbiItem,
  keccak256,
  parseAbi,
  zeroAddress,
  type AbiEvent,
  type Address,
  type Log,
  type PublicClient,
} from 'viem';
import type { Deployment } from './deployment';
import { deploymentBlock } from './generated/abis';
import { getLogsChunked } from './logs';

export interface EpochRecord {
  budget: bigint;
  checkIns: bigint;
  finalised: boolean;
}

export interface WalletState {
  address: Address;
  balance: bigint;
  allowance: bigint;
  isRegistered: boolean;
  bondOf: bigint;
  bondUnlockEpoch: bigint;
  checkedInCurrent: boolean;
}

export interface PoolSnapshot {
  fetchedAt: number;
  blockNumber: bigint;
  /** Timestamp of the latest block when the snapshot was read. */
  chainTimestamp: bigint;
  genesis: bigint;
  epochDuration: bigint;
  bond: bigint;
  tokenAddress: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  currentEpoch: bigint;
  pool: bigint;
  totalBonds: bigint;
  reservedRewards: bigint;
  lastBudgetEpoch: bigint;
  current: EpochRecord;
  last: EpochRecord;
  wallet: WalletState | null;
}

export async function readSnapshot(client: PublicClient, deployment: Deployment, account?: Address): Promise<PoolSnapshot> {
  const pool = { address: deployment.pool.address, abi: deployment.pool.abi } as const;
  const token = { address: deployment.token.address, abi: deployment.token.abi } as const;
  const [block, genesis, epochDuration, bond, tokenAddress, currentEpoch, poolBalance, totalBonds, reservedRewards, lastBudgetEpoch] =
    await Promise.all([
      // Latest block: its timestamp anchors the countdown to chain time rather than the device clock.
      client.getBlock({ blockTag: 'latest' }),
      client.readContract({ ...pool, functionName: 'genesis' }),
      client.readContract({ ...pool, functionName: 'EPOCH_DURATION' }),
      client.readContract({ ...pool, functionName: 'BOND' }),
      client.readContract({ ...pool, functionName: 'token' }),
      client.readContract({ ...pool, functionName: 'currentEpoch' }),
      client.readContract({ ...pool, functionName: 'pool' }),
      client.readContract({ ...pool, functionName: 'totalBonds' }),
      client.readContract({ ...pool, functionName: 'reservedRewards' }),
      client.readContract({ ...pool, functionName: 'lastBudgetEpoch' }),
    ]);

  const [tokenSymbol, tokenDecimals, current, last, wallet] = await Promise.all([
    client.readContract({ ...token, functionName: 'symbol' }),
    client.readContract({ ...token, functionName: 'decimals' }),
    client.readContract({ ...pool, functionName: 'epochInfo', args: [currentEpoch] }),
    client.readContract({ ...pool, functionName: 'epochInfo', args: [lastBudgetEpoch] }),
    account ? readWallet(client, deployment, account, currentEpoch) : Promise.resolve(null),
  ]);

  return {
    fetchedAt: Date.now(),
    blockNumber: block.number,
    chainTimestamp: block.timestamp,
    genesis,
    epochDuration,
    bond,
    tokenAddress,
    tokenSymbol,
    tokenDecimals,
    currentEpoch,
    pool: poolBalance,
    totalBonds,
    reservedRewards,
    lastBudgetEpoch,
    current: { budget: current[0], checkIns: current[1], finalised: current[2] },
    last: { budget: last[0], checkIns: last[1], finalised: last[2] },
    wallet,
  };
}

async function readWallet(client: PublicClient, deployment: Deployment, account: Address, currentEpoch: bigint): Promise<WalletState> {
  const pool = { address: deployment.pool.address, abi: deployment.pool.abi } as const;
  const token = { address: deployment.token.address, abi: deployment.token.abi } as const;
  const [balance, allowance, isRegistered, bondOf, bondUnlockEpoch, checkedInCurrent] = await Promise.all([
    client.readContract({ ...token, functionName: 'balanceOf', args: [account] }),
    client.readContract({ ...token, functionName: 'allowance', args: [account, deployment.pool.address] }),
    client.readContract({ ...pool, functionName: 'isRegistered', args: [account] }),
    client.readContract({ ...pool, functionName: 'bondOf', args: [account] }),
    client.readContract({ ...pool, functionName: 'bondUnlockEpoch', args: [account] }),
    client.readContract({ ...pool, functionName: 'checkedIn', args: [currentEpoch, account] }),
  ]);
  return { address: account, balance, allowance, isRegistered, bondOf, bondUnlockEpoch, checkedInCurrent };
}

// ---------------------------------------------------------------------------------------------
// Event history: touched epochs from EpochRolled, the wallet's participation from CheckedIn.

interface LogCache {
  scannedTo: bigint;
  rolled: Map<string, { epoch: bigint; budget: bigint }>;
  checkedIn: Map<string, bigint>;
}

const REORG_OVERLAP = 24n;
const caches = new Map<string, LogCache>();

function logKey(log: Log): string {
  return `${log.transactionHash}:${log.logIndex}`;
}

export interface EpochHistoryRow {
  epoch: bigint;
  budget: bigint;
  checkIns: bigint;
  finalised: boolean;
  isPast: boolean;
  youCheckedIn: boolean;
  claimed: boolean;
  claimable: bigint;
}

export interface EpochHistory {
  scannedTo: bigint;
  touchedEpochs: bigint[];
  currentOpened: boolean;
  rows: EpochHistoryRow[];
}

export const HISTORY_ROWS = 40;

export async function readHistory(
  client: PublicClient,
  deployment: Deployment,
  currentEpoch: bigint,
  account?: Address,
): Promise<EpochHistory> {
  const cacheKey = `${deployment.chain.id}:${deployment.pool.address}:${account ?? 'none'}`;
  // Uncached: viem memoises getBlockNumber for the polling interval, which would leave a freshly
  // mined transaction's events out of the scan right after confirmation.
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  const cache = caches.get(cacheKey) ?? { scannedTo: BigInt(deploymentBlock) - 1n, rolled: new Map(), checkedIn: new Map() };
  const from = cache.scannedTo + 1n - REORG_OVERLAP < BigInt(deploymentBlock) ? BigInt(deploymentBlock) : cache.scannedTo + 1n - REORG_OVERLAP;

  if (from <= latest) {
    const rolledEvent = getAbiItem({ abi: deployment.pool.abi, name: 'EpochRolled' }) as AbiEvent;
    const rolledLogs = await getLogsChunked(client, { address: deployment.pool.address, event: rolledEvent, fromBlock: from, toBlock: latest });
    for (const log of rolledLogs) {
      const args = (log as unknown as { args: { epoch: bigint; budget: bigint } }).args;
      cache.rolled.set(logKey(log), { epoch: args.epoch, budget: args.budget });
    }
    if (account) {
      const checkedInEvent = getAbiItem({ abi: deployment.pool.abi, name: 'CheckedIn' }) as AbiEvent;
      const checkedInLogs = await getLogsChunked(client, {
        address: deployment.pool.address,
        event: checkedInEvent,
        args: { worker: account },
        fromBlock: from,
        toBlock: latest,
      });
      for (const log of checkedInLogs) {
        const args = (log as unknown as { args: { epoch: bigint; worker: Address } }).args;
        cache.checkedIn.set(logKey(log), args.epoch);
      }
    }
    cache.scannedTo = latest;
    caches.set(cacheKey, cache);
  }

  const touched = [...new Set([...cache.rolled.values()].map((r) => r.epoch))].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const yourEpochs = new Set(cache.checkedIn.values());
  const listed = touched.slice(0, HISTORY_ROWS);
  const pool = { address: deployment.pool.address, abi: deployment.pool.abi } as const;

  const rows = await Promise.all(
    listed.map(async (epoch): Promise<EpochHistoryRow> => {
      const isPast = epoch < currentEpoch;
      const youCheckedIn = yourEpochs.has(epoch);
      const [info, claimed, claimable] = await Promise.all([
        client.readContract({ ...pool, functionName: 'epochInfo', args: [epoch] }),
        account && youCheckedIn ? client.readContract({ ...pool, functionName: 'claimed', args: [epoch, account] }) : Promise.resolve(false),
        account && youCheckedIn && isPast
          ? client.readContract({ ...pool, functionName: 'claimable', args: [epoch, account] })
          : Promise.resolve(0n),
      ]);
      return { epoch, budget: info[0], checkIns: info[1], finalised: info[2], isPast, youCheckedIn, claimed, claimable };
    }),
  );

  return { scannedTo: latest, touchedEpochs: touched, currentOpened: touched.includes(currentEpoch), rows };
}

/** Test hook: forget cached logs (also useful after switching deployments). */
export function resetHistoryCache(): void {
  caches.clear();
}

// ---------------------------------------------------------------------------------------------
// Launch-pool quote. Read-only simulation through the vetted quoter; never a transaction.

export const quoterAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
  'function quoteExactOutputSingle(QuoteExactSingleParams params) returns (uint256 amountIn, uint256 gasEstimate)',
]);

/** Launch pool key: native ETH paired with SPON, fee 3000, tick spacing 60, no hook (from the manifest). */
export const LAUNCH_POOL = { pairedCurrency: zeroAddress as Address, fee: 3000, tickSpacing: 60, hooks: zeroAddress as Address } as const;

export function launchPoolKey(tokenAddress: Address) {
  const paired = LAUNCH_POOL.pairedCurrency;
  const sorted = paired.toLowerCase() < tokenAddress.toLowerCase() ? [paired, tokenAddress] : [tokenAddress, paired];
  return {
    currency0: sorted[0] as Address,
    currency1: sorted[1] as Address,
    fee: LAUNCH_POOL.fee,
    tickSpacing: LAUNCH_POOL.tickSpacing,
    hooks: LAUNCH_POOL.hooks,
  };
}

export function launchPoolId(tokenAddress: Address): `0x${string}` {
  const key = launchPoolKey(tokenAddress);
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

export interface LaunchQuote {
  ethIn: bigint;
  sponOut: bigint;
  bondEthCost: bigint | null;
}

export async function readLaunchQuote(client: PublicClient, deployment: Deployment, tokenAddress: Address, bond: bigint): Promise<LaunchQuote> {
  const poolKey = launchPoolKey(tokenAddress);
  const ethIsCurrency0 = poolKey.currency0 === LAUNCH_POOL.pairedCurrency;
  const quoter = { address: deployment.network.uniswapV4.quoter, abi: quoterAbi } as const;
  const ethIn = 10n ** 16n; // 0.01 ETH reference amount
  const input = await client.simulateContract({
    ...quoter,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey, zeroForOne: ethIsCurrency0, exactAmount: ethIn, hookData: '0x' }],
  });
  let bondEthCost: bigint | null = null;
  try {
    const output = await client.simulateContract({
      ...quoter,
      functionName: 'quoteExactOutputSingle',
      args: [{ poolKey, zeroForOne: ethIsCurrency0, exactAmount: bond, hookData: '0x' }],
    });
    bondEthCost = output.result[0];
  } catch {
    bondEthCost = null;
  }
  return { ethIn, sponOut: input.result[0], bondEthCost };
}
