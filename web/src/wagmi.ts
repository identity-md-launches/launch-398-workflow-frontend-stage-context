import { createConfig, createStorage, fallback, http, type Config, type CreateConnectorFn, type Transport } from 'wagmi';
import { injected } from 'wagmi/connectors';
import type { Deployment } from './deployment';

interface StorageLike {
  getItem(key: string): string | null | undefined | Promise<string | null | undefined>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface ConfigOverrides {
  /** Test hook: replaces browser wallet discovery. */
  connectors?: CreateConnectorFn[];
  /** Test hook: replaces the public RPC fallback transport. */
  transport?: Transport;
  /** Test hook: persistence for the last-connected wallet; null disables it. */
  storage?: StorageLike | null;
  /** Test hook: receipt/block polling interval in milliseconds. */
  pollingInterval?: number;
}

/**
 * Builds the wagmi config from the runtime deployment. Reads go through the vetted public RPC list
 * with fallback; signing stays in the visitor's wallet. Browser wallets are discovered through
 * EIP-6963 plus the legacy window.ethereum provider; no WalletConnect project ID is configured.
 */
export function createAppConfig(deployment: Deployment, overrides: ConfigOverrides = {}): Config {
  const chain = deployment.chain;
  const transport =
    overrides.transport ??
    fallback(
      deployment.network.rpcUrls.map((url) => http(url, { batch: { batchSize: 20 }, timeout: 15_000 })),
      { rank: false },
    );
  const storage =
    overrides.storage === null
      ? null
      : createStorage({ storage: overrides.storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined) });
  return createConfig({
    chains: [chain],
    connectors: overrides.connectors ?? [injected()],
    multiInjectedProviderDiscovery: overrides.connectors === undefined,
    transports: { [chain.id]: transport },
    storage,
    ssr: false,
    // Block polling drives live reads; Sepolia blocks arrive every 12 s.
    pollingInterval: overrides.pollingInterval ?? 12_000,
  });
}
