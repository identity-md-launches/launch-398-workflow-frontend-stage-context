import { useAccount } from 'wagmi';
import { ActivityStatus } from './components/ActivityStatus';
import { ContractsCard } from './components/ContractsCard';
import { EpochCard } from './components/EpochCard';
import { GetSponCard } from './components/GetSponCard';
import { HistoryCard } from './components/HistoryCard';
import { SponsorCard } from './components/SponsorCard';
import { Notice } from './components/ui';
import { WalletBar } from './components/WalletBar';
import { WalletCard } from './components/WalletCard';
import { WorkerCard, type Gate } from './components/WorkerCard';
import type { Deployment } from './deployment';
import { useAction, useHistory, useSnapshot } from './hooks';

export function Page({ deployment }: { deployment: Deployment }) {
  const { isConnected, chainId } = useAccount();
  const snapshot = useSnapshot(deployment);
  const history = useHistory(deployment, snapshot.data?.currentEpoch);
  const { state: action, run, reset, inFlight } = useAction(deployment);
  const wrongChain = isConnected && chainId !== deployment.chain.id;
  const gate: Gate = {
    blocked: !isConnected
      ? 'Connect a wallet to use this action.'
      : wrongChain
        ? `Switch the wallet to ${deployment.network.name} to send transactions.`
        : null,
  };

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-title">
          <h1>Daemon Sponsor</h1>
          <p className="tagline">SPON worker bonds, check-ins and sponsorship on {deployment.network.name}</p>
        </div>
        <WalletBar deployment={deployment} />
      </header>
      <main id="main" className="page">
        {snapshot.isError ? (
          <Notice tone="danger" role="alert" title="Unable to read the contract">
            {snapshot.error.message}. The configured public RPCs will be retried automatically.
          </Notice>
        ) : null}
        <ActivityStatus state={action} deployment={deployment} onDismiss={reset} />
        <div className="grid">
          <EpochCard snapshot={snapshot.data} history={history.data} />
          <WalletCard snapshot={snapshot.data} connected={isConnected} wrongChain={wrongChain} />
          <WorkerCard deployment={deployment} snapshot={snapshot.data} gate={gate} action={action} inFlight={inFlight} run={run} />
          <SponsorCard deployment={deployment} snapshot={snapshot.data} gate={gate} action={action} inFlight={inFlight} run={run} />
          <div className="grid-full">
            <HistoryCard
              deployment={deployment}
              snapshot={snapshot.data}
              history={history.data}
              historyError={history.error}
              connected={isConnected}
              gate={gate}
              action={action}
              inFlight={inFlight}
              run={run}
            />
          </div>
          <GetSponCard deployment={deployment} snapshot={snapshot.data} />
          <ContractsCard deployment={deployment} snapshot={snapshot.data} />
        </div>
      </main>
      <footer className="site-footer">
        <p>
          Static page; reads use public RPCs and transactions are signed in your wallet. Built from source commit <span className="mono" translate="no">{deployment.manifest.sourceCommit.slice(0, 12)}</span>.
        </p>
      </footer>
    </>
  );
}
