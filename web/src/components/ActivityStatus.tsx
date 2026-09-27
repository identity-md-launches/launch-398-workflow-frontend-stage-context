import type { Deployment } from '../deployment';
import { shortHash } from '../format';
import type { ActionState } from '../hooks';
import { Button, ExternalLink } from './ui';

const PHASE_TEXT: Record<ActionState['phase'], string> = {
  idle: '',
  simulating: 'Checking the call against the contract…',
  wallet: 'Confirm in the wallet.',
  pending: 'Sent. Waiting for confirmation…',
  confirmed: 'Confirmed.',
  error: '',
};

/** Always-mounted polite live region for transaction progress; errors render as an alert inside it. */
export function ActivityStatus({ state, deployment, onDismiss }: { state: ActionState; deployment: Deployment; onDismiss: () => void }) {
  const tone = state.phase === 'error' ? (state.error?.kind === 'rejected' ? 'warning' : 'danger') : state.phase === 'confirmed' ? 'success' : 'info';
  return (
    <div className="activity" role="status" aria-live="polite" aria-atomic="true">
      {state.phase === 'idle' ? null : (
        <div className={`notice notice-${tone}`}>
          <span className="notice-mark" aria-hidden="true">
            {tone === 'success' ? '✓' : tone === 'danger' ? '✕' : tone === 'warning' ? '!' : 'i'}
          </span>
          <div className="notice-body">
            <p className="notice-title">{state.label}</p>
            {state.phase === 'error' && state.error ? (
              <p role="alert">{state.error.message}</p>
            ) : (
              <p>{PHASE_TEXT[state.phase]}</p>
            )}
            {state.hash ? (
              <p className="activity-hash" translate="no">
                Transaction <ExternalLink href={deployment.explorer.tx(state.hash)}>{shortHash(state.hash)}</ExternalLink>
              </p>
            ) : null}
            {state.error?.detail && state.error.detail !== state.error.message ? (
              <p className="activity-detail">Details: {state.error.detail}</p>
            ) : null}
          </div>
          {state.phase === 'confirmed' || state.phase === 'error' ? (
            <Button onClick={onDismiss} className="notice-dismiss">
              Dismiss
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
