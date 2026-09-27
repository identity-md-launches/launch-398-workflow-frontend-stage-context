/** Pure epoch arithmetic mirroring DaemonSponsorPool: epoch = (timestamp - genesis) / duration. */

export function epochAt(timestampSeconds: bigint, genesis: bigint, duration: bigint): bigint {
  if (timestampSeconds < genesis || duration === 0n) return 0n;
  return (timestampSeconds - genesis) / duration;
}

/** Unix seconds when the epoch after `epoch` begins: genesis + (epoch + 1) * duration. */
export function epochEndsAt(epoch: bigint, genesis: bigint, duration: bigint): bigint {
  return genesis + (epoch + 1n) * duration;
}

export function epochStartsAt(epoch: bigint, genesis: bigint, duration: bigint): bigint {
  return genesis + epoch * duration;
}

/**
 * Budget the next opened epoch would receive if a transaction rolled it now: the last budgeted
 * epoch's refund (its whole budget with no check-ins, otherwise its division dust) is returned to
 * the pool before a seventh is reserved. Matches _rollEpoch; label it as an estimate.
 */
export function previewNextBudget(input: {
  pool: bigint;
  lastBudget: bigint;
  lastCheckIns: bigint;
  lastFinalised: boolean;
  hasBudget: boolean;
}): bigint {
  let pool = input.pool;
  if (input.hasBudget && !input.lastFinalised) {
    pool += input.lastCheckIns === 0n ? input.lastBudget : input.lastBudget % input.lastCheckIns;
  }
  return pool / 7n;
}

/** Share for a past epoch: floor(budget / checkIns), or zero when nobody checked in. */
export function shareOf(budget: bigint, checkIns: bigint): bigint {
  return checkIns === 0n ? 0n : budget / checkIns;
}
