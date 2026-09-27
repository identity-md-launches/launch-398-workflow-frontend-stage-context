import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem';

export type ActionErrorKind = 'rejected' | 'reverted' | 'failed';

export interface ActionError {
  kind: ActionErrorKind;
  message: string;
  detail?: string;
}

/** Plain-language explanations for the contract's custom errors, phrased as what to do next. */
const REVERT_MESSAGES: Record<string, string> = {
  BondAlreadyHeld: 'This address already holds a bond. Withdraw it before registering again.',
  NotRegistered: 'This address is not registered, so it cannot check in or deregister.',
  StillRegistered: 'Deregister before withdrawing the bond.',
  NoBond: 'There is no bond to withdraw for this address.',
  BondLocked: 'The bond stays locked until the epoch after deregistration begins.',
  AlreadyCheckedIn: 'This address has already checked in during the current epoch.',
  EpochNotPast: 'Only past epochs can be claimed. Wait for the epoch to end.',
  NotCheckedIn: 'This address did not check in during that epoch, so there is nothing to claim.',
  AlreadyClaimed: 'That epoch has already been claimed by this address.',
  ZeroAmount: 'Enter an amount greater than zero.',
  ERC20InsufficientAllowance: 'The pool is not approved for this amount. Approve first, then retry.',
  ERC20InsufficientBalance: 'The wallet does not hold enough SPON for this amount.',
  SafeERC20FailedOperation: 'The token transfer failed. Check the SPON balance and approval, then retry.',
  ReentrancyGuardReentrantCall: 'The contract rejected a reentrant call.',
};

export function describeError(error: unknown): ActionError {
  if (error instanceof BaseError) {
    const rejected = error.walk((e) => e instanceof UserRejectedRequestError);
    if (rejected) return { kind: 'rejected', message: 'Request cancelled in the wallet. Nothing was sent.' };
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName ?? reverted.reason ?? 'unknown reason';
      const friendly = REVERT_MESSAGES[name];
      return {
        kind: 'reverted',
        message: friendly ?? `The contract rejected this call (${name}).`,
        detail: friendly ? name : reverted.shortMessage,
      };
    }
    const code = (error as { code?: number }).code;
    if (code === 4001) return { kind: 'rejected', message: 'Request cancelled in the wallet. Nothing was sent.' };
    const detail = error.details;
    return { kind: 'failed', message: `Unable to complete the request: ${error.shortMessage}`, ...(detail ? { detail } : {}) };
  }
  if (error && typeof error === 'object' && (error as { code?: number }).code === 4001) {
    return { kind: 'rejected', message: 'Request cancelled in the wallet. Nothing was sent.' };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: 'failed', message: `Unable to complete the request: ${message}` };
}
