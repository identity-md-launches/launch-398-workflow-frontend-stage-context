// Shared helpers for the build scripts. Plain Node, no bundler.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, stringToHex } from 'viem';

export const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = resolve(webRoot, '..');
export const distDir = resolve(repoRoot, 'dist');
export const abiSourceDir = resolve(repoRoot, 'docs', 'abi');
export const handoffPath = resolve(webRoot, 'deployment', 'handoff.json');
export const networkPath = resolve(webRoot, 'deployment', 'network.json');

/** Recursively sort object keys so JSON.stringify yields a canonical form. */
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

/** Canonical Keccak-256 of an ABI: keccak(compact JSON with sorted keys), 64 lowercase hex chars without 0x. */
export function canonicalKeccak(abi) {
  return keccak256(stringToHex(JSON.stringify(sortKeys(abi)))).slice(2);
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** All files under dir, as posix-style paths relative to dir, sorted. */
export function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export function loadHandoff() {
  const handoff = readJson(handoffPath);
  const networkFile = readJson(networkPath);
  if (handoff.version !== 1) throw new Error(`Unexpected handoff version ${handoff.version}`);
  if (handoff.chainId !== networkFile.network.chainId) {
    throw new Error(`handoff chainId ${handoff.chainId} differs from network.json ${networkFile.network.chainId}`);
  }
  return { handoff, network: networkFile.network, walletAddChain: networkFile.walletAddChain };
}
