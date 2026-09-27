// Runtime deployment configuration. The app has exactly one source of addresses, chain settings,
// public RPC URLs and ABIs: dist/imd-deployment.json, written by scripts/build-manifest.mjs from
// the attested handoff. Nothing here hard-codes a deployment value.
import { keccak256, stringToHex, type Abi, type Address, type Chain, type Hex } from 'viem';
import { daemonSponsorPoolAbi, launchTokenAbi } from './generated/abis';

export interface DeploymentContract {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
}

export interface UniswapV4Addresses {
  poolManager: Address;
  universalRouter: Address;
  quoter: Address;
  stateView: Address;
  positionManager: Address;
  permit2: Address;
}

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets: string[];
  uniswapV4: UniswapV4Addresses;
}

export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: DeploymentContract[];
  assets: { path: string; sha256: string }[];
  network: NetworkBlock;
}

export type PoolAbi = typeof daemonSponsorPoolAbi;
export type TokenAbi = typeof launchTokenAbi;

export interface Deployment {
  manifest: DeploymentManifest;
  network: NetworkBlock;
  chain: Chain;
  pool: { address: Address; abi: PoolAbi };
  token: { address: Address; abi: TokenAbi };
  /** Exact parameters for wallet_addEthereumChain, derived from the network block. */
  walletAddChain: WalletAddChainParams;
  explorer: {
    address: (a: Address) => string;
    tx: (h: Hex) => string;
  };
}

export interface WalletAddChainParams {
  chainId: Hex;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls: string[];
}

export const POOL_CONTRACT = 'DaemonSponsorPool';
export const TOKEN_CONTRACT = 'LaunchToken';
export const MANIFEST_FILE = 'imd-deployment.json';

export class DeploymentError extends Error {
  override name = 'DeploymentError';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Canonical Keccak-256 of an ABI array: compact JSON with recursively sorted keys, no 0x prefix. */
export function canonicalAbiHash(abi: unknown): string {
  return keccak256(stringToHex(JSON.stringify(sortKeys(abi)))).slice(2);
}

const isHexAddress = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const isHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const isRelativePath = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && !v.startsWith('/') && !v.includes('..') && !/^[a-z]+:/i.test(v);

export function validateManifest(input: unknown): DeploymentManifest {
  const m = input as Partial<DeploymentManifest> | null;
  if (!m || typeof m !== 'object') throw new DeploymentError('Deployment configuration is not an object.');
  if (m.version !== 1) throw new DeploymentError(`Unsupported deployment configuration version ${String(m.version)}.`);
  if (typeof m.launchId !== 'string' || !m.launchId) throw new DeploymentError('launchId is missing.');
  if (typeof m.chainId !== 'number' || !Number.isInteger(m.chainId) || m.chainId <= 0) {
    throw new DeploymentError('chainId is missing or invalid.');
  }
  if (typeof m.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(m.sourceCommit)) {
    throw new DeploymentError('sourceCommit is missing or invalid.');
  }
  if (!isHash(m.attestationHash)) throw new DeploymentError('attestationHash is missing or invalid.');
  if (!Array.isArray(m.contracts) || m.contracts.length === 0) throw new DeploymentError('contracts list is empty.');
  for (const c of m.contracts) {
    if (typeof c.name !== 'string' || !isHexAddress(c.address) || !isHash(c.abiHash) || !isRelativePath(c.abiPath)) {
      throw new DeploymentError(`Contract entry ${String(c?.name)} is malformed.`);
    }
  }
  if (!Array.isArray(m.assets)) throw new DeploymentError('assets list is missing.');
  const n = m.network as Partial<NetworkBlock> | undefined;
  if (!n || typeof n !== 'object') throw new DeploymentError('network block is missing.');
  if (n.chainId !== m.chainId) throw new DeploymentError('network.chainId disagrees with chainId.');
  if (typeof n.name !== 'string' || !Array.isArray(n.rpcUrls) || n.rpcUrls.length === 0) {
    throw new DeploymentError('network name or rpcUrls are missing.');
  }
  if (typeof n.explorer !== 'string' || !n.nativeCurrency || typeof n.nativeCurrency.decimals !== 'number') {
    throw new DeploymentError('network explorer or nativeCurrency are missing.');
  }
  const u = n.uniswapV4 as Partial<UniswapV4Addresses> | undefined;
  for (const key of ['poolManager', 'universalRouter', 'quoter', 'stateView', 'positionManager', 'permit2'] as const) {
    if (!u || !isHexAddress(u[key])) throw new DeploymentError(`network.uniswapV4.${key} is missing.`);
  }
  for (const name of [POOL_CONTRACT, TOKEN_CONTRACT]) {
    if (!m.contracts.some((c) => c.name === name)) throw new DeploymentError(`Contract ${name} is not in the deployment.`);
  }
  return m as DeploymentManifest;
}

export function buildChain(network: NetworkBlock): Chain {
  return {
    id: network.chainId,
    name: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: network.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: network.explorer } },
    testnet: network.testnet,
  };
}

export function buildWalletAddChain(network: NetworkBlock): WalletAddChainParams {
  return {
    chainId: `0x${network.chainId.toString(16)}`,
    chainName: network.name,
    rpcUrls: network.rpcUrls,
    nativeCurrency: network.nativeCurrency,
    blockExplorerUrls: [network.explorer],
  };
}

async function fetchJson(url: URL, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { cache: 'no-cache' });
  } catch (e) {
    throw new DeploymentError(`Unable to load ${url.pathname.split('/').pop()}: ${(e as Error).message}`);
  }
  if (!response.ok) throw new DeploymentError(`Unable to load ${url.pathname.split('/').pop()} (HTTP ${response.status}).`);
  try {
    return await response.json();
  } catch {
    throw new DeploymentError(`${url.pathname.split('/').pop()} is not valid JSON.`);
  }
}

async function loadAbi(
  base: URL,
  contract: DeploymentContract,
  expectedTypes: Abi,
  fetchImpl: typeof fetch,
): Promise<Abi> {
  const abi = await fetchJson(new URL(contract.abiPath, base), fetchImpl);
  if (!Array.isArray(abi)) throw new DeploymentError(`${contract.abiPath} is not an ABI array.`);
  const hash = canonicalAbiHash(abi);
  if (hash !== contract.abiHash) {
    throw new DeploymentError(`${contract.abiPath} does not match the attested ABI hash for ${contract.name}.`);
  }
  if (canonicalAbiHash(expectedTypes) !== hash) {
    throw new DeploymentError(`The compiled ABI types for ${contract.name} are stale; rebuild the site.`);
  }
  return abi as Abi;
}

export interface LoadOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Loads and validates the runtime deployment configuration and the ABI files it references. */
export async function loadDeployment(options: LoadOptions = {}): Promise<Deployment> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = new URL(options.baseUrl ?? document.baseURI);
  const manifest = validateManifest(await fetchJson(new URL(MANIFEST_FILE, base), fetchImpl));
  const poolEntry = manifest.contracts.find((c) => c.name === POOL_CONTRACT)!;
  const tokenEntry = manifest.contracts.find((c) => c.name === TOKEN_CONTRACT)!;
  const [poolAbi, tokenAbi] = await Promise.all([
    loadAbi(base, poolEntry, daemonSponsorPoolAbi as unknown as Abi, fetchImpl),
    loadAbi(base, tokenEntry, launchTokenAbi as unknown as Abi, fetchImpl),
  ]);
  const network = manifest.network;
  const explorerBase = network.explorer.replace(/\/$/, '');
  return {
    manifest,
    network,
    chain: buildChain(network),
    pool: { address: poolEntry.address, abi: poolAbi as unknown as PoolAbi },
    token: { address: tokenEntry.address, abi: tokenAbi as unknown as TokenAbi },
    walletAddChain: buildWalletAddChain(network),
    explorer: {
      address: (a) => `${explorerBase}/address/${a}`,
      tx: (h) => `${explorerBase}/tx/${h}`,
    },
  };
}
