// In-memory EIP-1193 provider that behaves like a browser wallet plus a Sepolia node holding the
// LaunchToken and DaemonSponsorPool contracts. Contract logic mirrors src/DaemonSponsorPool.sol so
// the page can be exercised end to end without funds or a network.
import {
  RpcRequestError,
  UserRejectedRequestError,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  keccak256,
  numberToHex,
  stringToHex,
  type Address,
  type Hex,
} from 'viem';
import { daemonSponsorPoolAbi, launchTokenAbi } from '../src/generated/abis';

export const ZERO = '0x0000000000000000000000000000000000000000' as Address;
export const BOND = 100_000n * 10n ** 18n;
export const EPOCH = 86_400n;

interface EpochState {
  budget: bigint;
  checkIns: bigint;
  finalised: boolean;
}

interface ChainState {
  timestamp: bigint;
  blockNumber: bigint;
  balances: Map<string, bigint>;
  allowances: Map<string, bigint>;
  pool: bigint;
  totalBonds: bigint;
  reservedRewards: bigint;
  lastBudgetEpoch: bigint;
  hasBudget: boolean;
  epochs: Map<string, EpochState>;
  isRegistered: Map<string, boolean>;
  bondOf: Map<string, bigint>;
  bondUnlockEpoch: Map<string, bigint>;
  checkedIn: Set<string>;
  claimed: Set<string>;
}

export interface MockLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: Hex;
  logIndex: Hex;
  removed: boolean;
}

class Revert extends Error {
  constructor(
    public errorName: string,
    public args: unknown[] = [],
  ) {
    super(errorName);
  }
}

export interface MockChainOptions {
  poolAddress: Address;
  tokenAddress: Address;
  accounts: Address[];
  /** Chain the wallet is currently on. */
  walletChainId?: number;
  /** Chains the wallet knows; switching to another one fails with 4902 until it is added. */
  knownChains?: number[];
  genesis?: bigint;
  now?: bigint;
  deploymentBlock?: bigint;
  balances?: Record<string, bigint>;
  /** Some wallets switch automatically after wallet_addEthereumChain; default false to exercise the second switch. */
  autoSwitchAfterAdd?: boolean;
}

export class MockChain {
  readonly poolAddress: Address;
  readonly tokenAddress: Address;
  readonly accounts: Address[];
  readonly genesis: bigint;
  walletChainId: number;
  knownChains: Set<number>;
  authorized = false;
  rejectNext = false;
  /** Every JSON-RPC method the page sent, for assertions. */
  readonly requests: { method: string; params: unknown }[] = [];
  readonly logs: MockLog[] = [];
  readonly receipts = new Map<string, Record<string, unknown>>();
  readonly transactions = new Map<string, Record<string, unknown>>();
  state: ChainState;
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private txCounter = 0;
  private readonly autoSwitchAfterAdd: boolean;

  constructor(options: MockChainOptions) {
    this.poolAddress = options.poolAddress;
    this.tokenAddress = options.tokenAddress;
    this.accounts = options.accounts;
    this.walletChainId = options.walletChainId ?? 11155111;
    this.knownChains = new Set(options.knownChains ?? [11155111]);
    this.autoSwitchAfterAdd = options.autoSwitchAfterAdd ?? false;
    const genesis = options.genesis ?? 1_790_000_000n;
    this.genesis = genesis;
    const balances = new Map<string, bigint>();
    for (const [k, v] of Object.entries(options.balances ?? {})) balances.set(k.toLowerCase(), v);
    this.state = {
      timestamp: options.now ?? genesis + 3600n,
      blockNumber: options.deploymentBlock ?? 11_791_704n,
      balances,
      allowances: new Map(),
      pool: 0n,
      totalBonds: 0n,
      reservedRewards: 0n,
      lastBudgetEpoch: 0n,
      hasBudget: false,
      epochs: new Map(),
      isRegistered: new Map(),
      bondOf: new Map(),
      bondUnlockEpoch: new Map(),
      checkedIn: new Set(),
      claimed: new Set(),
    };
  }

  // --- EIP-1193 surface -----------------------------------------------------------------------

  readonly provider = {
    request: (args: { method: string; params?: unknown }) => this.request(args.method, args.params),
    on: (event: string, listener: (...args: unknown[]) => void) => {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(listener);
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      this.listeners.get(event)?.delete(listener);
    },
  };

  private emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  advanceTime(seconds: bigint) {
    this.state.timestamp += seconds;
    this.state.blockNumber += 1n;
  }

  /** New block without a time change; the page re-reads on every block. */
  mineBlock() {
    this.state.blockNumber += 1n;
  }

  currentEpoch(state = this.state): bigint {
    return (state.timestamp - this.genesis) / EPOCH;
  }

  balanceOf(address: Address): bigint {
    return this.state.balances.get(address.toLowerCase()) ?? 0n;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    const p = (params ?? []) as unknown[];
    switch (method) {
      case 'eth_chainId':
        return numberToHex(this.walletChainId);
      case 'net_version':
        return String(this.walletChainId);
      case 'eth_accounts':
        return this.authorized ? this.accounts : [];
      case 'eth_requestAccounts':
        if (this.rejectNext) {
          this.rejectNext = false;
          throw new UserRejectedRequestError(new Error('User rejected the request.'));
        }
        this.authorized = true;
        return this.accounts;
      case 'wallet_requestPermissions':
        if (this.rejectNext) {
          this.rejectNext = false;
          throw new UserRejectedRequestError(new Error('User rejected the request.'));
        }
        this.authorized = true;
        return [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: this.accounts }] }];
      case 'wallet_switchEthereumChain': {
        const target = Number((p[0] as { chainId: string }).chainId);
        if (!this.knownChains.has(target)) {
          throw Object.assign(new Error('Unrecognized chain ID. Try adding the chain first.'), { code: 4902 });
        }
        if (this.walletChainId !== target) {
          this.walletChainId = target;
          this.emit('chainChanged', numberToHex(target));
        }
        return null;
      }
      case 'wallet_addEthereumChain': {
        const target = Number((p[0] as { chainId: string }).chainId);
        this.knownChains.add(target);
        if (this.autoSwitchAfterAdd && this.walletChainId !== target) {
          this.walletChainId = target;
          this.emit('chainChanged', numberToHex(target));
        }
        return null;
      }
      case 'eth_blockNumber':
        return numberToHex(this.state.blockNumber);
      case 'eth_getBlockByNumber':
        return this.block(this.state.blockNumber);
      case 'eth_gasPrice':
        return '0x3b9aca00';
      case 'eth_estimateGas':
        this.simulate(p[0] as CallParams, structuredClone(this.state));
        return '0x186a0';
      case 'eth_call':
        return this.simulate(p[0] as CallParams, structuredClone(this.state));
      case 'eth_sendTransaction':
        return this.send(p[0] as CallParams);
      case 'eth_getTransactionReceipt':
        return this.receipts.get((p[0] as string).toLowerCase()) ?? null;
      case 'eth_getTransactionByHash':
        return this.transactions.get((p[0] as string).toLowerCase()) ?? null;
      case 'eth_getLogs':
        return this.getLogs(p[0] as LogFilter);
      default:
        throw new Error(`MockChain: unsupported method ${method}`);
    }
  }

  private block(number: bigint) {
    return {
      number: numberToHex(number),
      hash: keccak256(stringToHex(`block-${number}`)),
      parentHash: keccak256(stringToHex(`block-${number - 1n}`)),
      timestamp: numberToHex(this.state.timestamp),
      gasLimit: '0x1c9c380',
      gasUsed: '0x0',
      baseFeePerGas: '0x1',
      miner: ZERO,
      nonce: '0x0000000000000000',
      transactions: [],
      logsBloom: `0x${'0'.repeat(512)}`,
      difficulty: '0x0',
      extraData: '0x',
      mixHash: `0x${'0'.repeat(64)}`,
      receiptsRoot: `0x${'0'.repeat(64)}`,
      sha3Uncles: `0x${'0'.repeat(64)}`,
      stateRoot: `0x${'0'.repeat(64)}`,
      transactionsRoot: `0x${'0'.repeat(64)}`,
      size: '0x0',
      totalDifficulty: '0x0',
      uncles: [],
    };
  }

  private getLogs(filter: LogFilter): MockLog[] {
    const from = filter.fromBlock && filter.fromBlock !== 'latest' ? BigInt(filter.fromBlock) : 0n;
    const to = filter.toBlock && filter.toBlock !== 'latest' ? BigInt(filter.toBlock) : this.state.blockNumber;
    if (to - from > 50_000n) {
      throw new RpcRequestError({ body: { method: 'eth_getLogs' }, url: 'mock://', error: { code: -32005, message: 'query exceeds max block range 50000' } });
    }
    const addresses = filter.address ? (Array.isArray(filter.address) ? filter.address : [filter.address]).map((a) => a.toLowerCase()) : null;
    return this.logs.filter((log) => {
      const n = BigInt(log.blockNumber);
      if (n < from || n > to) return false;
      if (addresses && !addresses.includes(log.address.toLowerCase())) return false;
      if (filter.topics) {
        for (let i = 0; i < filter.topics.length; i++) {
          const want = filter.topics[i];
          if (want === null || want === undefined) continue;
          const have = log.topics[i];
          if (!have) return false;
          const options = (Array.isArray(want) ? want : [want]).map((t) => t.toLowerCase());
          if (!options.includes(have.toLowerCase())) return false;
        }
      }
      return true;
    });
  }

  // --- Execution -------------------------------------------------------------------------------

  private send(call: CallParams): Hex {
    if (this.rejectNext) {
      this.rejectNext = false;
      throw new UserRejectedRequestError(new Error('User rejected the request.'));
    }
    const hash = keccak256(stringToHex(`tx-${++this.txCounter}`));
    const next = structuredClone(this.state);
    next.blockNumber += 1n;
    const pending: MockLog[] = [];
    this.simulate(call, next, (log) => pending.push(log));
    this.state = next;
    const blockNumber = numberToHex(this.state.blockNumber);
    const blockHash = keccak256(stringToHex(`block-${this.state.blockNumber}`));
    pending.forEach((log, i) => {
      this.logs.push({ ...log, blockNumber, blockHash, transactionHash: hash, transactionIndex: '0x0', logIndex: numberToHex(i) });
    });
    const receipt = {
      transactionHash: hash,
      transactionIndex: '0x0',
      blockHash,
      blockNumber,
      from: call.from,
      to: call.to,
      cumulativeGasUsed: '0x5208',
      gasUsed: '0x5208',
      effectiveGasPrice: '0x3b9aca00',
      contractAddress: null,
      logs: this.logs.filter((l) => l.transactionHash === hash),
      logsBloom: `0x${'0'.repeat(512)}`,
      status: '0x1',
      type: '0x2',
    };
    this.receipts.set(hash.toLowerCase(), receipt);
    this.transactions.set(hash.toLowerCase(), {
      hash,
      blockHash,
      blockNumber,
      from: call.from,
      to: call.to,
      input: call.data,
      nonce: numberToHex(this.txCounter),
      value: '0x0',
      gas: '0x5208',
      gasPrice: '0x3b9aca00',
      transactionIndex: '0x0',
      type: '0x2',
      chainId: numberToHex(this.walletChainId),
      v: '0x0',
      r: '0x0',
      s: '0x0',
    });
    return hash;
  }

  /** Executes a call against `state`, returning ABI-encoded output; reverts become RpcRequestErrors. */
  private simulate(call: CallParams, state: ChainState, emit: (log: MockLog) => void = () => {}): Hex {
    const to = (call.to ?? '').toLowerCase();
    const from = (call.from ?? ZERO).toLowerCase() as Address;
    try {
      if (to === this.tokenAddress.toLowerCase()) return this.runToken(call.data, from, state, emit);
      if (to === this.poolAddress.toLowerCase()) return this.runPool(call.data, from, state, emit);
      throw new Error(`MockChain: no contract at ${call.to}`);
    } catch (error) {
      if (error instanceof Revert) {
        const abi = to === this.tokenAddress.toLowerCase() ? launchTokenAbi : daemonSponsorPoolAbi;
        const data = encodeErrorResult({ abi, errorName: error.errorName as never, args: error.args as never });
        throw new RpcRequestError({ body: { method: 'eth_call' }, url: 'mock://', error: { code: 3, message: 'execution reverted', data } });
      }
      throw error;
    }
  }

  private log(address: Address, abi: typeof launchTokenAbi | typeof daemonSponsorPoolAbi, eventName: string, args: Record<string, unknown>): MockLog {
    const event = abi.find((item) => item.type === 'event' && item.name === eventName) as unknown as { inputs: { name: string; type: string; indexed: boolean }[] };
    const topics = encodeEventTopics({ abi, eventName: eventName as never, args: args as never });
    const unindexed = event.inputs.filter((i) => !i.indexed);
    const data = unindexed.length ? encodeAbiParameters(unindexed, unindexed.map((i) => args[i.name])) : '0x';
    return { address, topics: topics as Hex[], data, blockNumber: '0x0', blockHash: '0x', transactionHash: '0x', transactionIndex: '0x0', logIndex: '0x0', removed: false };
  }

  private runToken(data: Hex, from: Address, state: ChainState, emit: (log: MockLog) => void): Hex {
    const { functionName, args = [] } = decodeFunctionData({ abi: launchTokenAbi, data });
    const a = args as readonly unknown[];
    const bal = (addr: string) => state.balances.get(addr.toLowerCase()) ?? 0n;
    const setBal = (addr: string, v: bigint) => state.balances.set(addr.toLowerCase(), v);
    const allowKey = (owner: string, spender: string) => `${owner.toLowerCase()}:${spender.toLowerCase()}`;
    const out = (result: unknown) => encodeFunctionResult({ abi: launchTokenAbi, functionName: functionName as never, result: result as never });
    switch (functionName) {
      case 'name':
        return out('Sponsor');
      case 'symbol':
        return out('SPON');
      case 'decimals':
        return out(18);
      case 'totalSupply':
        return out(10n ** 27n);
      case 'balanceOf':
        return out(bal(a[0] as string));
      case 'allowance':
        return out(state.allowances.get(allowKey(a[0] as string, a[1] as string)) ?? 0n);
      case 'approve': {
        state.allowances.set(allowKey(from, a[0] as string), a[1] as bigint);
        emit(this.log(this.tokenAddress, launchTokenAbi, 'Approval', { owner: from, spender: a[0], value: a[1] }));
        return out(true);
      }
      case 'transfer': {
        const value = a[1] as bigint;
        if (bal(from) < value) throw new Revert('ERC20InsufficientBalance', [from, bal(from), value]);
        setBal(from, bal(from) - value);
        setBal(a[0] as string, bal(a[0] as string) + value);
        emit(this.log(this.tokenAddress, launchTokenAbi, 'Transfer', { from, to: a[0], value }));
        return out(true);
      }
      case 'transferFrom': {
        const [owner, to, value] = a as [string, string, bigint];
        const key = allowKey(owner, from);
        const allowance = state.allowances.get(key) ?? 0n;
        if (allowance < value) throw new Revert('ERC20InsufficientAllowance', [from, allowance, value]);
        if (bal(owner) < value) throw new Revert('ERC20InsufficientBalance', [owner, bal(owner), value]);
        state.allowances.set(key, allowance - value);
        setBal(owner, bal(owner) - value);
        setBal(to, bal(to) + value);
        emit(this.log(this.tokenAddress, launchTokenAbi, 'Transfer', { from: owner, to, value }));
        return out(true);
      }
      default:
        throw new Error(`MockChain: token function ${functionName} not implemented`);
    }
  }

  private runPool(data: Hex, from: Address, state: ChainState, emit: (log: MockLog) => void): Hex {
    const { functionName, args = [] } = decodeFunctionData({ abi: daemonSponsorPoolAbi, data });
    const a = args as readonly unknown[];
    const out = (result: unknown) => encodeFunctionResult({ abi: daemonSponsorPoolAbi, functionName: functionName as never, result: result as never });
    const epochOf = (e: bigint): EpochState => {
      const key = e.toString();
      if (!state.epochs.has(key)) state.epochs.set(key, { budget: 0n, checkIns: 0n, finalised: false });
      return state.epochs.get(key)!;
    };
    const current = this.currentEpoch(state);
    const key = (e: bigint, w: string) => `${e}:${w.toLowerCase()}`;
    const pool = this.poolAddress;
    const transferIn = (amount: bigint) => {
      // SafeERC20.safeTransferFrom(msg.sender, pool, amount)
      const allowKey = `${from.toLowerCase()}:${pool.toLowerCase()}`;
      const allowance = state.allowances.get(allowKey) ?? 0n;
      if (allowance < amount) throw new Revert('ERC20InsufficientAllowance', [pool, allowance, amount]);
      const bal = state.balances.get(from.toLowerCase()) ?? 0n;
      if (bal < amount) throw new Revert('ERC20InsufficientBalance', [from, bal, amount]);
      state.allowances.set(allowKey, allowance - amount);
      state.balances.set(from.toLowerCase(), bal - amount);
      state.balances.set(pool.toLowerCase(), (state.balances.get(pool.toLowerCase()) ?? 0n) + amount);
      emit(this.log(this.tokenAddress, launchTokenAbi, 'Transfer', { from, to: pool, value: amount }));
    };
    const transferOut = (amount: bigint) => {
      state.balances.set(pool.toLowerCase(), (state.balances.get(pool.toLowerCase()) ?? 0n) - amount);
      state.balances.set(from.toLowerCase(), (state.balances.get(from.toLowerCase()) ?? 0n) + amount);
      emit(this.log(this.tokenAddress, launchTokenAbi, 'Transfer', { from: pool, to: from, value: amount }));
    };
    const roll = (): bigint => {
      if (state.hasBudget && current === state.lastBudgetEpoch) return current;
      if (state.hasBudget) {
        const previous = epochOf(state.lastBudgetEpoch);
        const returned = previous.checkIns === 0n ? previous.budget : previous.budget % previous.checkIns;
        previous.finalised = true;
        state.pool += returned;
        state.reservedRewards -= returned;
      }
      const budget = state.pool / 7n;
      state.pool -= budget;
      state.reservedRewards += budget;
      epochOf(current).budget = budget;
      state.lastBudgetEpoch = current;
      state.hasBudget = true;
      emit(this.log(pool, daemonSponsorPoolAbi, 'EpochRolled', { epoch: current, budget }));
      return current;
    };

    switch (functionName) {
      case 'BOND':
        return out(BOND);
      case 'EPOCH_DURATION':
        return out(EPOCH);
      case 'token':
        return out(this.tokenAddress);
      case 'genesis':
        return out(this.genesis);
      case 'currentEpoch':
        return out(current);
      case 'pool':
        return out(state.pool);
      case 'totalBonds':
        return out(state.totalBonds);
      case 'reservedRewards':
        return out(state.reservedRewards);
      case 'lastBudgetEpoch':
        return out(state.lastBudgetEpoch);
      case 'epochInfo': {
        const e = state.epochs.get((a[0] as bigint).toString()) ?? { budget: 0n, checkIns: 0n, finalised: false };
        return out([e.budget, e.checkIns, e.finalised]);
      }
      case 'isRegistered':
        return out(state.isRegistered.get((a[0] as string).toLowerCase()) ?? false);
      case 'bondOf':
        return out(state.bondOf.get((a[0] as string).toLowerCase()) ?? 0n);
      case 'bondUnlockEpoch':
        return out(state.bondUnlockEpoch.get((a[0] as string).toLowerCase()) ?? 0n);
      case 'checkedIn':
        return out(state.checkedIn.has(key(a[0] as bigint, a[1] as string)));
      case 'claimed':
        return out(state.claimed.has(key(a[0] as bigint, a[1] as string)));
      case 'claimable': {
        const [e, w] = a as [bigint, string];
        if (e >= current || !state.checkedIn.has(key(e, w)) || state.claimed.has(key(e, w))) return out(0n);
        const info = epochOf(e);
        return out(info.checkIns === 0n ? 0n : info.budget / info.checkIns);
      }
      case 'register': {
        roll();
        if ((state.bondOf.get(from) ?? 0n) !== 0n) throw new Revert('BondAlreadyHeld');
        state.isRegistered.set(from, true);
        state.bondOf.set(from, BOND);
        state.totalBonds += BOND;
        transferIn(BOND);
        emit(this.log(pool, daemonSponsorPoolAbi, 'Registered', { worker: from }));
        return '0x';
      }
      case 'deregister': {
        const epoch = roll();
        if (!state.isRegistered.get(from)) throw new Revert('NotRegistered');
        state.isRegistered.set(from, false);
        state.bondUnlockEpoch.set(from, epoch + 1n);
        emit(this.log(pool, daemonSponsorPoolAbi, 'Deregistered', { worker: from, unlockEpoch: epoch + 1n }));
        return '0x';
      }
      case 'withdrawBond': {
        const epoch = roll();
        const amount = state.bondOf.get(from) ?? 0n;
        if (amount === 0n) throw new Revert('NoBond');
        if (state.isRegistered.get(from)) throw new Revert('StillRegistered');
        const unlock = state.bondUnlockEpoch.get(from) ?? 0n;
        if (epoch < unlock) throw new Revert('BondLocked', [unlock]);
        state.bondOf.delete(from);
        state.bondUnlockEpoch.delete(from);
        state.totalBonds -= amount;
        transferOut(amount);
        emit(this.log(pool, daemonSponsorPoolAbi, 'BondWithdrawn', { worker: from, amount }));
        return '0x';
      }
      case 'sponsor': {
        roll();
        const amount = a[0] as bigint;
        if (amount === 0n) throw new Revert('ZeroAmount');
        state.pool += amount;
        transferIn(amount);
        emit(this.log(pool, daemonSponsorPoolAbi, 'Sponsored', { sponsor: from, amount }));
        return '0x';
      }
      case 'checkIn': {
        const epoch = roll();
        if (!state.isRegistered.get(from)) throw new Revert('NotRegistered');
        if (state.checkedIn.has(key(epoch, from))) throw new Revert('AlreadyCheckedIn');
        state.checkedIn.add(key(epoch, from));
        epochOf(epoch).checkIns += 1n;
        emit(this.log(pool, daemonSponsorPoolAbi, 'CheckedIn', { epoch, worker: from }));
        return '0x';
      }
      case 'claim': {
        const cur = roll();
        const epoch = a[0] as bigint;
        if (epoch >= cur) throw new Revert('EpochNotPast');
        if (!state.checkedIn.has(key(epoch, from))) throw new Revert('NotCheckedIn');
        if (state.claimed.has(key(epoch, from))) throw new Revert('AlreadyClaimed');
        const info = epochOf(epoch);
        const amount = info.budget / info.checkIns;
        state.claimed.add(key(epoch, from));
        state.reservedRewards -= amount;
        transferOut(amount);
        emit(this.log(pool, daemonSponsorPoolAbi, 'Claimed', { epoch, worker: from, amount }));
        return out(amount);
      }
      default:
        throw new Error(`MockChain: pool function ${functionName} not implemented`);
    }
  }
}

interface CallParams {
  from?: Address;
  to?: Address;
  data: Hex;
  value?: Hex;
}

interface LogFilter {
  address?: Address | Address[];
  topics?: (Hex | Hex[] | null)[];
  fromBlock?: string;
  toBlock?: string;
}
