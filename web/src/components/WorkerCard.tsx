import { useState } from 'react';
import type { Deployment } from '../deployment';
import { epochStartsAt } from '../epoch';
import { formatDateTime, formatSpon } from '../format';
import type { ActionState, RunParams } from '../hooks';
import type { PoolSnapshot } from '../reads';
import { Badge, Button, Card, Reason, Step, Steps } from './ui';
import type { Abi, ContractFunctionArgs, ContractFunctionName } from 'viem';

export interface Gate {
  /** Null when the wallet is connected on the right chain; otherwise the reason actions are unavailable. */
  blocked: string | null;
}

export type Run = <
  const abi extends Abi,
  functionName extends ContractFunctionName<abi, 'nonpayable' | 'payable'>,
  args extends ContractFunctionArgs<abi, 'nonpayable' | 'payable', functionName>,
>(params: RunParams<abi, functionName, args>) => Promise<boolean>;

interface Props {
  deployment: Deployment;
  snapshot: PoolSnapshot | undefined;
  gate: Gate;
  action: ActionState;
  inFlight: boolean;
  run: Run;
}

export function WorkerCard({ deployment, snapshot, gate, action, inFlight, run }: Props) {
  const [confirmDeregister, setConfirmDeregister] = useState(false);
  const wallet = snapshot?.wallet ?? null;
  const decimals = snapshot?.tokenDecimals ?? 18;
  const bond = snapshot?.bond ?? 0n;
  const busy = (key: string) => inFlight && action.key === key;

  const registered = wallet?.isRegistered ?? false;
  const bonded = (wallet?.bondOf ?? 0n) > 0n;
  const allowanceOk = wallet ? wallet.allowance >= bond : false;
  const balanceOk = wallet ? wallet.balance >= bond : false;
  const canWithdraw = wallet && snapshot ? bonded && !registered && snapshot.currentEpoch >= wallet.bondUnlockEpoch : false;

  const pool = { address: deployment.pool.address, abi: deployment.pool.abi } as const;
  const token = { address: deployment.token.address, abi: deployment.token.abi } as const;

  const approveBond = () =>
    run({ key: 'approve-bond', label: `Approve ${formatSpon(bond, decimals)} for the pool`, ...token, functionName: 'approve', args: [deployment.pool.address, bond] });
  const register = () => run({ key: 'register', label: 'Register worker (bond 100,000 SPON)', ...pool, functionName: 'register' });
  const checkIn = () => run({ key: 'check-in', label: `Check in to epoch #${snapshot?.currentEpoch.toString() ?? ''}`, ...pool, functionName: 'checkIn' });
  const deregister = async () => {
    setConfirmDeregister(false);
    await run({ key: 'deregister', label: 'Deregister worker', ...pool, functionName: 'deregister' });
  };
  const withdraw = () => run({ key: 'withdraw', label: `Withdraw bond of ${formatSpon(wallet?.bondOf ?? 0n, decimals)}`, ...pool, functionName: 'withdrawBond' });

  const blocked = gate.blocked ?? (wallet ? null : 'Loading wallet state…');

  return (
    <Card id="worker" title="Worker" description="Bond 100,000 SPON to register, then check in once per epoch to earn an equal share of that epoch's budget.">
      {blocked ? <Reason>{blocked}</Reason> : null}

      {registered ? (
        <div className="status-line">
          <Badge tone="success">Registered</Badge>
          <span>Bond {formatSpon(wallet?.bondOf ?? 0n, decimals)} held.</span>
        </div>
      ) : bonded ? (
        <div className="status-line">
          <Badge tone="warning">Deregistered</Badge>
          <span>Bond {formatSpon(wallet?.bondOf ?? 0n, decimals)} awaiting withdrawal.</span>
        </div>
      ) : (
        <Steps>
          <Step title="1. Approve the bond" done={Boolean(wallet) && allowanceOk}>
            <p className="muted">Allow the pool to pull {formatSpon(bond, decimals)} from this wallet. This approval is spent by registering.</p>
            <Button variant={allowanceOk ? 'secondary' : 'primary'} onClick={approveBond} busy={busy('approve-bond')} disabled={Boolean(blocked) || inFlight || allowanceOk}>
              Approve {formatSpon(bond, decimals)}
            </Button>
            {wallet && !balanceOk ? (
              <Reason>
                This wallet holds {formatSpon(wallet.balance, decimals)}; the bond needs {formatSpon(bond, decimals)}. <a href="#get-spon">Get SPON from the launch pool</a>.
              </Reason>
            ) : null}
          </Step>
          <Step title="2. Register">
            <p className="muted">Pulls the bond into the pool and makes this address eligible to check in. The bond is collateral, never spent.</p>
            <Button variant="primary" onClick={register} busy={busy('register')} disabled={Boolean(blocked) || inFlight || !allowanceOk || !balanceOk}>
              Register worker
            </Button>
            {wallet && !allowanceOk ? <Reason>Approve the bond first.</Reason> : null}
          </Step>
        </Steps>
      )}

      {registered && snapshot && wallet ? (
        <div className="action-row">
          <div>
            <Button variant="primary" onClick={checkIn} busy={busy('check-in')} disabled={Boolean(blocked) || inFlight || wallet.checkedInCurrent}>
              Check in to epoch #{snapshot.currentEpoch.toString()}
            </Button>
            {wallet.checkedInCurrent ? <Reason>Already checked in this epoch. Come back after the boundary.</Reason> : null}
          </div>
          <div>
            {confirmDeregister ? (
              <div className="confirm" role="group" aria-labelledby="deregister-confirm">
                <p id="deregister-confirm">
                  Deregister this worker? Check-ins stop immediately and the bond unlocks when epoch #{(snapshot.currentEpoch + 1n).toString()} begins. Existing claims stay available.
                </p>
                <div className="button-row">
                  <Button variant="danger" onClick={deregister} busy={busy('deregister')}>
                    Deregister worker
                  </Button>
                  <Button onClick={() => setConfirmDeregister(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDeregister(true)} disabled={Boolean(blocked) || inFlight}>
                Deregister…
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {bonded && !registered && snapshot && wallet ? (
        <div className="action-row">
          <div>
            <Button variant="primary" onClick={withdraw} busy={busy('withdraw')} disabled={Boolean(blocked) || inFlight || !canWithdraw}>
              Withdraw bond
            </Button>
            {!canWithdraw ? (
              <Reason>
                Unlocks at epoch #{wallet.bondUnlockEpoch.toString()}, {formatDateTime(epochStartsAt(wallet.bondUnlockEpoch, snapshot.genesis, snapshot.epochDuration))}. After withdrawing you can register again.
              </Reason>
            ) : (
              <Reason>Returns the bond to this wallet. You can register again afterwards.</Reason>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
