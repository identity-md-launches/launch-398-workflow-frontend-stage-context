import { formatSpon } from '../format';
import type { PoolSnapshot } from '../reads';
import { Badge, Card, Reason, Stat, StatList } from './ui';

export function WalletCard({ snapshot, connected, wrongChain }: { snapshot: PoolSnapshot | undefined; connected: boolean; wrongChain: boolean }) {
  const wallet = snapshot?.wallet ?? null;
  const decimals = snapshot?.tokenDecimals ?? 18;
  return (
    <Card id="wallet" title="Your wallet" description="SPON balance, the amount the pool may pull, and this address's worker status.">
      {!connected ? (
        <div className="empty">
          <p className="empty-title">No wallet connected</p>
          <p className="muted">Use the connect control in the header to see balances and act on the pool.</p>
        </div>
      ) : wrongChain ? (
        <Reason>Reads use the configured public RPC and stay live; switch the wallet's network to send transactions.</Reason>
      ) : null}
      {connected && !wallet ? <p className="muted" aria-busy="true">Loading wallet state…</p> : null}
      {wallet && snapshot ? (
        <StatList>
          <Stat label="SPON balance" value={formatSpon(wallet.balance, decimals)} />
          <Stat label="Approved for the pool" value={formatSpon(wallet.allowance, decimals)} hint="Spent by registering or sponsoring." />
          <Stat
            label="Worker status"
            value={wallet.isRegistered ? <Badge tone="success">Registered</Badge> : wallet.bondOf > 0n ? <Badge tone="warning">Deregistered</Badge> : <Badge tone="neutral">Not registered</Badge>}
            hint={wallet.bondOf > 0n ? `Bond ${formatSpon(wallet.bondOf, decimals)}` : undefined}
          />
          <Stat
            label={`Epoch #${snapshot.currentEpoch.toString()}`}
            value={wallet.checkedInCurrent ? <Badge tone="success">Checked in</Badge> : wallet.isRegistered ? <Badge tone="warning">Not checked in</Badge> : '—'}
          />
        </StatList>
      ) : null}
    </Card>
  );
}
