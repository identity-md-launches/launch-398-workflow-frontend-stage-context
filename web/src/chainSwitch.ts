import type { EIP1193Provider } from 'viem';
import type { WalletAddChainParams } from './deployment';

interface RpcErrorLike {
  code?: number;
  message?: string;
  data?: { originalError?: { code?: number } };
}

/** True when a wallet reports that it does not know the requested chain. */
export function isUnknownChainError(error: unknown): boolean {
  const e = (error ?? {}) as RpcErrorLike;
  if (e.code === 4902 || e.data?.originalError?.code === 4902) return true;
  const message = (e.message ?? '').toLowerCase();
  return /unrecognized chain|unknown chain|chain.*not (been )?added|not (a )?supported chain|try adding the chain/.test(message);
}

/**
 * wallet_switchEthereumChain, then wallet_addEthereumChain with the vetted parameters when the
 * wallet does not know the chain (code 4902 or an "unknown chain" message), then switch again.
 */
export async function switchOrAddChain(provider: EIP1193Provider, params: WalletAddChainParams): Promise<void> {
  const switchRequest = () =>
    provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: params.chainId }] });
  try {
    await switchRequest();
    return;
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
  }
  await provider.request({ method: 'wallet_addEthereumChain', params: [params] });
  const current = (await provider.request({ method: 'eth_chainId' })) as string;
  if (current.toLowerCase() !== params.chainId.toLowerCase()) await switchRequest();
}
