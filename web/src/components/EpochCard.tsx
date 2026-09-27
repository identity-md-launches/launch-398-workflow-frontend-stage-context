import { epochEndsAt, previewNextBudget } from '../epoch';
import { formatDateTime, formatDuration, formatSpon } from '../format';
import { useNow } from '../hooks';
import type { EpochHistory, PoolSnapshot } from '../reads';
import { Badge, Card, Stat, StatList } from './ui';

export function EpochCard({ snapshot, history }: { snapshot: PoolSnapshot | undefined; history: EpochHistory | undefined }) {
  const now = useNow();
  if (!snapshot) {
    return (
      <Card id="epoch" title="Current epoch">
        <p className="muted" aria-busy="true">Loading epoch state from the chain…</p>
      </Card>
    );
  }
  const endsAt = epochEndsAt(snapshot.currentEpoch, snapshot.genesis, snapshot.epochDuration);
  // Chain time, advanced by the seconds elapsed since the snapshot; independent of device clock skew.
  const chainNow = Number(snapshot.chainTimestamp) + Math.floor((now - snapshot.fetchedAt) / 1000);
  const remaining = Number(endsAt) - chainNow;
  const opened = history ? history.currentOpened : undefined;
  const hasBudget = history ? history.touchedEpochs.length > 0 : snapshot.lastBudgetEpoch > 0n;
  const preview = previewNextBudget({
    pool: snapshot.pool,
    lastBudget: snapshot.last.budget,
    lastCheckIns: snapshot.last.checkIns,
    lastFinalised: snapshot.last.finalised,
    hasBudget,
  });

  return (
    <Card id="epoch" title="Current epoch" description="Epochs are 24 hours long, counted from the deployment timestamp. Any successful transaction opens the current epoch with a seventh of the pool.">
      <StatList>
        <Stat label="Epoch" value={<span translate="no">#{snapshot.currentEpoch.toString()}</span>} hint={opened === undefined ? undefined : opened ? <Badge tone="success">Open</Badge> : <Badge tone="neutral">Not opened yet</Badge>} />
        <Stat
          label="Ends in"
          value={remaining > 0 ? <time dateTime={new Date(Number(endsAt) * 1000).toISOString()}>{formatDuration(remaining)}</time> : 'Boundary reached'}
          hint={remaining > 0 ? formatDateTime(endsAt) : 'The next transaction opens the following epoch.'}
        />
        <Stat
          label="Budget"
          value={opened ? formatSpon(snapshot.current.budget, snapshot.tokenDecimals) : `≈ ${formatSpon(preview, snapshot.tokenDecimals)}`}
          hint={opened ? 'Shared equally by everyone who checks in.' : 'Estimate: what the next transaction would reserve.'}
        />
        <Stat label="Check-ins" value={snapshot.current.checkIns.toString()} hint="Workers checked in during this epoch." />
        <Stat label="Sponsorship pool" value={formatSpon(snapshot.pool, snapshot.tokenDecimals)} hint="Gifts not yet reserved as budgets." />
        <Stat label="Reserved rewards" value={formatSpon(snapshot.reservedRewards, snapshot.tokenDecimals)} hint="Unclaimed shares plus the latest budget." />
        <Stat label="Bonds held" value={formatSpon(snapshot.totalBonds, snapshot.tokenDecimals)} hint="Locked worker collateral, never spent." />
      </StatList>
    </Card>
  );
}
