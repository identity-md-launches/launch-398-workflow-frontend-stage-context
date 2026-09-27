import { useId, useState } from 'react';
import type { Deployment } from '../deployment';
import { formatSpon, parseAmount } from '../format';
import type { ActionState } from '../hooks';
import type { PoolSnapshot } from '../reads';
import { Button, Card, Reason, Step, Steps } from './ui';
import type { Gate, Run } from './WorkerCard';

interface Props {
  deployment: Deployment;
  snapshot: PoolSnapshot | undefined;
  gate: Gate;
  action: ActionState;
  inFlight: boolean;
  run: Run;
}

export function SponsorCard({ deployment, snapshot, gate, action, inFlight, run }: Props) {
  const inputId = useId();
  const hintId = useId();
  const [input, setInput] = useState('');
  const [touched, setTouched] = useState(false);
  const wallet = snapshot?.wallet ?? null;
  const decimals = snapshot?.tokenDecimals ?? 18;
  const amount = parseAmount(input, decimals);
  const invalid = touched && input.trim() !== '' && amount === null;
  const allowanceOk = wallet && amount !== null ? wallet.allowance >= amount : false;
  const balanceOk = wallet && amount !== null ? wallet.balance >= amount : false;
  const blocked = gate.blocked ?? (wallet ? null : 'Loading wallet state…');
  const busy = (key: string) => inFlight && action.key === key;

  const approve = () =>
    amount !== null &&
    run({
      key: 'approve-sponsor',
      label: `Approve ${formatSpon(amount, decimals)} for the pool`,
      address: deployment.token.address,
      abi: deployment.token.abi,
      functionName: 'approve',
      args: [deployment.pool.address, amount],
    });
  const sponsor = async () => {
    if (amount === null) return;
    const ok = await run({
      key: 'sponsor',
      label: `Sponsor ${formatSpon(amount, decimals)}`,
      address: deployment.pool.address,
      abi: deployment.pool.abi,
      functionName: 'sponsor',
      args: [amount],
    });
    if (ok) setInput('');
  };

  return (
    <Card id="sponsor" title="Sponsor" description="Gift SPON to the pool. Each opened epoch reserves a seventh of the pool for the workers who check in. Sponsorships cannot be withdrawn.">
      {blocked ? <Reason>{blocked}</Reason> : null}
      <div className="field">
        <label htmlFor={inputId}>Amount to sponsor (SPON)</label>
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="1000"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={invalid || undefined}
          aria-describedby={hintId}
          disabled={inFlight}
        />
        <p id={hintId} className={invalid ? 'field-error' : 'field-hint'}>
          {invalid
            ? `Enter a positive number with at most ${decimals} decimal places.`
            : wallet
              ? `Balance ${formatSpon(wallet.balance, decimals)} · approved ${formatSpon(wallet.allowance, decimals)}`
              : 'Decimal SPON amount, for example 1000 or 250.5'}
        </p>
      </div>
      <Steps>
        <Step title="1. Approve the amount" done={amount !== null && allowanceOk}>
          <Button variant={allowanceOk ? 'secondary' : 'primary'} onClick={approve} busy={busy('approve-sponsor')} disabled={Boolean(blocked) || inFlight || amount === null || allowanceOk}>
            Approve {amount !== null ? formatSpon(amount, decimals) : 'amount'}
          </Button>
          {wallet && amount !== null && !balanceOk ? (
            <Reason>
              This wallet holds {formatSpon(wallet.balance, decimals)}. <a href="#get-spon">Get SPON from the launch pool</a>.
            </Reason>
          ) : null}
        </Step>
        <Step title="2. Sponsor">
          <Button variant="primary" onClick={sponsor} busy={busy('sponsor')} disabled={Boolean(blocked) || inFlight || amount === null || !allowanceOk || !balanceOk}>
            Sponsor {amount !== null ? formatSpon(amount, decimals) : 'the pool'}
          </Button>
          {amount !== null && wallet && !allowanceOk ? <Reason>Approve the amount first.</Reason> : null}
          <Reason>This is an irrevocable gift. The current epoch's budget is snapshotted before the gift is added.</Reason>
        </Step>
      </Steps>
    </Card>
  );
}
