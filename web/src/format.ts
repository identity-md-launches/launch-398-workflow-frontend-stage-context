import { formatUnits, parseUnits, type Address, type Hex } from 'viem';

/** Formats minor units as a decimal string with thousands separators; never goes through a float. */
export function formatAmount(value: bigint, decimals: number, maxFraction = 4): string {
  const raw = formatUnits(value, decimals);
  const [whole = '0', fraction = ''] = raw.split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let frac = fraction.slice(0, maxFraction).replace(/0+$/, '');
  if (fraction.length > maxFraction && frac.length === 0 && fraction.replace(/0+$/, '').length > 0) frac = '';
  const truncated = fraction.replace(/0+$/, '').length > frac.length;
  return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}${truncated ? '…' : ''}`;
}

export function formatSpon(value: bigint, decimals = 18): string {
  return `${formatAmount(value, decimals)} SPON`;
}

/** Parses a user-typed decimal amount; returns null for anything that is not a positive amount. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') return null;
  const [, fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) return null;
  try {
    const value = parseUnits(trimmed, decimals);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

export function shortAddress(address: Address | string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: Hex | string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** d h m s countdown from a number of seconds. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

export function formatDateTime(unixSeconds: bigint | number): string {
  const ms = Number(unixSeconds) * 1000;
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
