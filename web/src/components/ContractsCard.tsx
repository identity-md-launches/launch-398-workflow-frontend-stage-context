import type { Deployment } from '../deployment';
import { shortHash } from '../format';
import type { PoolSnapshot } from '../reads';
import { Card, ExternalLink, Notice } from './ui';

export function ContractsCard({ deployment, snapshot }: { deployment: Deployment; snapshot: PoolSnapshot | undefined }) {
  const tokenMismatch = snapshot ? snapshot.tokenAddress.toLowerCase() !== deployment.token.address.toLowerCase() : false;
  return (
    <Card id="contracts" title="Contracts" description={`Deployed on ${deployment.network.name} (chain ${deployment.chain.id}). Addresses and ABIs are loaded from the attested deployment file shipped with this page.`}>
      {tokenMismatch && snapshot ? (
        <Notice tone="danger" role="alert" title="Token address mismatch">
          The pool reports token {snapshot.tokenAddress} but the deployment file lists {deployment.token.address}. Do not transact until this is resolved.
        </Notice>
      ) : null}
      <dl className="kv">
        {deployment.manifest.contracts.map((c) => (
          <div key={c.name}>
            <dt>{c.name}</dt>
            <dd className="mono" translate="no">
              <ExternalLink href={deployment.explorer.address(c.address)}>{c.address}</ExternalLink>
            </dd>
          </div>
        ))}
        <div>
          <dt>Launch ID</dt>
          <dd className="mono" translate="no">{deployment.manifest.launchId}</dd>
        </div>
        <div>
          <dt>Source commit</dt>
          <dd className="mono" translate="no">{deployment.manifest.sourceCommit}</dd>
        </div>
        <div>
          <dt>Attestation</dt>
          <dd className="mono" translate="no" title={deployment.manifest.attestationHash}>{shortHash(deployment.manifest.attestationHash)}</dd>
        </div>
        <div>
          <dt>Public RPCs</dt>
          <dd>
            {deployment.network.rpcUrls.map((u) => (
              <span key={u} className="mono rpc" translate="no">{new URL(u).hostname}</span>
            ))}
          </dd>
        </div>
      </dl>
      <p className="muted">
        This is a {deployment.network.testnet ? 'testnet' : ''} sponsorship toy modelled on worker daemons. It verifies no work and is not connected to any real payment. Sending SPON directly to the pool address bypasses accounting and is unrecoverable; always use the controls above.
      </p>
    </Card>
  );
}
