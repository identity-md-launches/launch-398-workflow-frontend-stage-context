import { useState } from 'react';
import type { EIP1193Provider } from 'viem';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { switchOrAddChain } from '../chainSwitch';
import type { Deployment } from '../deployment';
import { describeError } from '../errors';
import { shortAddress } from '../format';
import { Button, ExternalLink, Notice, Reason } from './ui';

export function WalletBar({ deployment }: { deployment: Deployment }) {
  const { address, isConnected, chainId, connector, status } = useAccount();
  const { connectors, connectAsync, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const discovered = connectors.filter((c) => c.id !== 'injected' || connectors.length === 1);
  const rightChain = chainId === deployment.chain.id;

  async function connectWith(connectorId: string) {
    const target = connectors.find((c) => c.id === connectorId);
    if (!target) return;
    setError(null);
    try {
      await connectAsync({ connector: target });
    } catch (e) {
      setError(describeError(e).message);
    }
  }

  async function switchChain() {
    if (!connector) return;
    setError(null);
    setSwitching(true);
    try {
      const provider = (await connector.getProvider()) as EIP1193Provider;
      await switchOrAddChain(provider, deployment.walletAddChain);
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="wallet-bar">
      {isConnected && address ? (
        <div className="wallet-connected">
          <span className="wallet-address" translate="no">
            <span className="sr-only">Connected wallet </span>
            <ExternalLink href={deployment.explorer.address(address)}>{shortAddress(address)}</ExternalLink>
          </span>
          {rightChain ? (
            <span className="chain-pill chain-ok">
              <span className="dot" aria-hidden="true" /> {deployment.network.name}
            </span>
          ) : (
            <Button variant="primary" onClick={switchChain} busy={switching}>
              Switch to {deployment.network.name}
            </Button>
          )}
          <Button onClick={() => disconnect()}>Disconnect</Button>
        </div>
      ) : (
        <div className="wallet-connect">
          {status === 'reconnecting' ? (
            <Reason>Reconnecting to the last wallet…</Reason>
          ) : discovered.length === 0 ? (
            <Reason>No browser wallet detected. Install a wallet extension such as MetaMask or Rabby, then reload this page.</Reason>
          ) : (
            discovered.map((c) => (
              <Button key={c.uid} variant="primary" busy={connecting} onClick={() => connectWith(c.id)}>
                Connect {c.name}
              </Button>
            ))
          )}
        </div>
      )}
      {error ? (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
