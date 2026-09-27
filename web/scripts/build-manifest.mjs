// Runs after `vite build`. Copies the implementation-derived ABI JSON into dist/abi, verifies each
// canonical Keccak hash against the deployment handoff, then writes dist/imd-deployment.json with a
// SHA-256 inventory of every other exported file.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { abiSourceDir, canonicalKeccak, distDir, listFiles, loadHandoff, sha256Hex } from './lib.mjs';

const MANIFEST = 'imd-deployment.json';
const MAX_ASSETS = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const EXPORT_BUDGET_BYTES = 24 * 1024 * 1024; // keep well under half of the checker's 64 MiB body budget

if (!existsSync(resolve(distDir, 'index.html'))) {
  throw new Error('dist/index.html is missing; run `vite build` first');
}

const { handoff, network } = loadHandoff();

// 1. ABIs: raw JSON arrays copied byte for byte from docs/abi at the pinned source commit.
const abiDir = resolve(distDir, 'abi');
rmSync(abiDir, { recursive: true, force: true });
mkdirSync(abiDir, { recursive: true });
const contracts = handoff.contracts.map((contract) => {
  const source = resolve(abiSourceDir, `${contract.name}.json`);
  const abi = JSON.parse(readFileSync(source, 'utf8'));
  if (!Array.isArray(abi)) throw new Error(`${source} is not a raw ABI array`);
  const hash = canonicalKeccak(abi);
  if (hash !== contract.abiHash) {
    throw new Error(`ABI hash mismatch for ${contract.name}: ${hash} != handoff ${contract.abiHash}`);
  }
  const abiPath = `abi/${contract.name}.json`;
  copyFileSync(source, resolve(distDir, abiPath));
  return { name: contract.name, address: contract.address, abiHash: contract.abiHash, abiPath };
});

// 2. Asset inventory: every exported file except the manifest itself.
rmSync(resolve(distDir, MANIFEST), { force: true });
const files = listFiles(distDir).filter((p) => p !== MANIFEST);
let total = 0;
const assets = files.map((path) => {
  const bytes = readFileSync(resolve(distDir, path));
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`${path} exceeds 8 MiB`);
  total += bytes.length;
  return { path, sha256: sha256Hex(bytes) };
});
if (assets.length > MAX_ASSETS) throw new Error(`${assets.length} assets exceed the limit of ${MAX_ASSETS}`);
if (total > EXPORT_BUDGET_BYTES) throw new Error(`export totals ${total} bytes, above the ${EXPORT_BUDGET_BYTES} byte budget`);
if (!assets.some((a) => a.path === 'index.html')) throw new Error('index.html missing from inventory');
for (const c of contracts) {
  if (!assets.some((a) => a.path === c.abiPath)) throw new Error(`${c.abiPath} missing from inventory`);
}

// 3. Manifest. `network` is the network block from .imd/reads/network.json, unchanged.
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets,
  network,
};
writeFileSync(resolve(distDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote dist/${MANIFEST}: ${contracts.length} contracts, ${assets.length} assets, ${total} bytes of assets`);
