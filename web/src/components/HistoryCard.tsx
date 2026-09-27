import type { Deployment } from '../deployment';
import { formatSpon } from '../format';
import type { ActionState } from '../hooks';
import { HISTORY_ROWS, type EpochHistory, type PoolSnapshot } from '../reads';
import { Badge, Button, Card, Notice, Reason } from './ui';
import type { Gate, Run } from './WorkerCard';

interface Props {
  deployment: Deployment;
  snapshot: PoolSnapshot | undefined;
  history: EpochHistory | undefined;
  historyError: Error | null;
  connected: boolean;
  gate: Gate;
  action: ActionState;
  inFlight: boolean;
  run: Run;
}

export function HistoryCard({ deployment, snapshot, history, historyError, connected, gate, action, inFlight, run }: Props) {
  const decimals = snapshot?.tokenDecimals ?? 18;
  const busyKey = (epoch: bigint) => `claim-${epoch.toString()}`;
  const claim = (epoch: bigint) =>
    run({
      key: busyKey(epoch),
      label: `Claim epoch #${epoch.toString()}`,
      address: deployment.pool.address,
      abi: deployment.pool.abi,
      functionName: 'claim',
      args: [epoch],
    });

  return (
    <Card id="history" title="Past epochs" description="Opened epochs from the contract's EpochRolled events, newest first. Your share is budget divided by check-ins, claimable once the epoch has ended.">
      {historyError ? (
        <Notice tone="danger" role="alert">
          Unable to load epoch history from the RPC: {historyError.message}. It will retry automatically.
        </Notice>
      ) : null}
      {!history && !historyError ? (
        <p className="muted" aria-busy="true">Scanning events from the deployment block…</p>
      ) : history && history.rows.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No epochs opened yet</p>
          <p className="muted">The first successful transaction on the pool opens the current epoch. Register or sponsor to start.</p>
        </div>
      ) : history ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Opened epochs with budget, check-ins and your claim status</caption>
            <thead>
              <tr>
                <th scope="col">Epoch</th>
                <th scope="col">Status</th>
                <th scope="col" className="num-col">Budget</th>
                <th scope="col" className="num-col">Check-ins</th>
                <th scope="col" className="num-col">Your share</th>
                <th scope="col">Claim</th>
              </tr>
            </thead>
            <tbody>
              {history.rows.map((row) => (
                <tr key={row.epoch.toString()}>
                  <th scope="row" translate="no">#{row.epoch.toString()}</th>
                  <td>
                    {!row.isPast ? <Badge tone="info">Current</Badge> : row.finalised ? <Badge tone="neutral">Finalised</Badge> : <Badge tone="neutral">Ended</Badge>}
                  </td>
                  <td className="num-col">{formatSpon(row.budget, decimals)}</td>
                  <td className="num-col">{row.checkIns.toString()}</td>
                  <td className="num-col">
                    {!connected ? '—' : !row.youCheckedIn ? <span className="muted">Not checked in</span> : row.isPast ? formatSpon(row.claimed ? (row.checkIns === 0n ? 0n : row.budget / row.checkIns) : row.claimable, decimals) : <span className="muted">Pending</span>}
                  </td>
                  <td>
                    {connected && row.youCheckedIn && row.isPast ? (
                      row.claimed ? (
                        <Badge tone="success">Claimed</Badge>
                      ) : (
                        <Button variant="primary" onClick={() => claim(row.epoch)} busy={inFlight && action.key === busyKey(row.epoch)} disabled={Boolean(gate.blocked) || inFlight}>
                          Claim {formatSpon(row.claimable, decimals)}
                        </Button>
                      )
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {history && history.touchedEpochs.length > HISTORY_ROWS ? (
        <Reason>Showing the latest {HISTORY_ROWS} of {history.touchedEpochs.length} opened epochs.</Reason>
      ) : null}
      {!connected && history && history.rows.length > 0 ? <Reason>Connect a wallet to see your shares and claim.</Reason> : null}
      {gate.blocked && connected ? <Reason>{gate.blocked}</Reason> : null}
    </Card>
  );
}
