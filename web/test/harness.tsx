// Shared test harness: builds a manifest from the committed handoff + docs/abi, serves it through a
// fake fetch, and wires the App to a MockChain wallet/RPC.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import type { Address } from 'viem';
import { custom } from 'viem';
import { injected } from 'wagmi/connectors';
import { App } from '../src/App';
import type { LoadOptions } from '../src/deployment';
import { resetHistoryCache } from '../src/reads';
import type { ConfigOverrides } from '../src/wagmi';
import { MockChain, type MockChainOptions } from './mockChain';

const webRoot = resolve(__dirname, '..');
export const handoff = JSON.parse(readFileSync(resolve(webRoot, 'deployment/handoff.json'), 'utf8')) as {
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string }[];
};
export const networkFile = JSON.parse(readFileSync(resolve(webRoot, 'deployment/network.json'), 'utf8')) as {
  network: Record<string, unknown> & { chainId: number; name: string };
  walletAddChain: Record<string, unknown>;
};
export const abiFiles: Record<string, string> = Object.fromEntries(
  handoff.contracts.map((c) => [c.name, readFileSync(resolve(webRoot, '..', 'docs/abi', `${c.name}.json`), 'utf8')]),
);

export const POOL = handoff.contracts.find((c) => c.name === 'DaemonSponsorPool')!.address;
export const TOKEN = handoff.contracts.find((c) => c.name === 'LaunchToken')!.address;
export const ALICE = '0x1111111111111111111111111111111111111111' as Address;

export function buildManifest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map((c) => ({ name: c.name, address: c.address, abiHash: c.abiHash, abiPath: `abi/${c.name}.json` })),
    assets: [{ path: 'index.html', sha256: '0'.repeat(64) }],
    network: networkFile.network,
    ...overrides,
  };
}

export function fakeFetch(files: Record<string, string>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/site\//, '');
    const body = files[path];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

export const BASE_URL = 'http://test.local/site/';

export function defaultFiles(manifest: unknown = buildManifest()): Record<string, string> {
  return {
    'imd-deployment.json': JSON.stringify(manifest),
    'abi/DaemonSponsorPool.json': abiFiles['DaemonSponsorPool']!,
    'abi/LaunchToken.json': abiFiles['LaunchToken']!,
  };
}

export function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

export function createChain(options: Partial<MockChainOptions> = {}): MockChain {
  return new MockChain({
    poolAddress: POOL,
    tokenAddress: TOKEN,
    accounts: [ALICE],
    balances: { [ALICE]: 250_000n * 10n ** 18n },
    ...options,
  });
}

export function renderApp(chain: MockChain, files: Record<string, string> = defaultFiles()) {
  resetHistoryCache();
  const loadOptions: LoadOptions = { fetchImpl: fakeFetch(files), baseUrl: BASE_URL };
  const configOverrides: ConfigOverrides = {
    connectors: [injected({ target: { id: 'mock', name: 'Mock Wallet', provider: chain.provider as never } })],
    transport: custom(chain.provider as never),
    storage: memoryStorage(),
    pollingInterval: 20,
  };
  return render(<App loadOptions={loadOptions} configOverrides={configOverrides} />);
}
