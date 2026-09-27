// Checks the committed export in ../dist against the handoff. Skipped when dist/ has not been built.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalAbiHash, validateManifest } from '../src/deployment';
import { handoff, networkFile } from './harness';

const dist = resolve(__dirname, '..', '..', 'dist');
const manifestPath = resolve(dist, 'imd-deployment.json');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

describe.skipIf(!existsSync(manifestPath))('committed export dist/', () => {
  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));

  it('copies identifiers, chain, contracts and network from the handoff', () => {
    expect(manifest.launchId).toBe(handoff.launchId);
    expect(manifest.chainId).toBe(handoff.chainId);
    expect(manifest.sourceCommit).toBe(handoff.sourceCommit);
    expect(manifest.attestationHash).toBe(handoff.attestationHash);
    expect(manifest.contracts.map((c) => [c.name, c.address, c.abiHash])).toEqual(handoff.contracts.map((c) => [c.name, c.address, c.abiHash]));
    expect(manifest.network).toEqual(networkFile.network);
  });

  it('ships every ABI as a raw array whose canonical hash matches', () => {
    for (const c of manifest.contracts) {
      const abi = JSON.parse(readFileSync(resolve(dist, c.abiPath), 'utf8'));
      expect(Array.isArray(abi)).toBe(true);
      expect(canonicalAbiHash(abi)).toBe(c.abiHash);
    }
  });

  it('lists every exported file except itself with a matching lowercase SHA-256', () => {
    const files = listFiles(dist).filter((p) => p !== 'imd-deployment.json');
    expect(manifest.assets.map((a) => a.path).sort()).toEqual(files);
    expect(files).toContain('index.html');
    expect(manifest.assets.length).toBeLessThanOrEqual(128);
    for (const asset of manifest.assets) {
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      const bytes = readFileSync(resolve(dist, asset.path));
      expect(bytes.length).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    }
  });

  it('uses a relative base so the page works from a gateway subpath', () => {
    const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
    expect(html).toMatch(/src="\.\/assets\//);
    expect(html).not.toMatch(/src="\/assets\//);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
