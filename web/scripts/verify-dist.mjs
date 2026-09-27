// Independent check of the committed export: every file in dist/ (except the manifest) is listed
// with a matching SHA-256, every listed file exists, ABI hashes and identifiers match the handoff,
// and the network block equals the vetted network table.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalKeccak, distDir, listFiles, loadHandoff, sha256Hex, sortKeys } from './lib.mjs';

const MANIFEST = 'imd-deployment.json';
const { handoff, network } = loadHandoff();
const manifest = JSON.parse(readFileSync(resolve(distDir, MANIFEST), 'utf8'));
const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };

expect(manifest.version === 1, 'version must be 1');
expect(manifest.launchId === handoff.launchId, 'launchId differs from handoff');
expect(manifest.chainId === handoff.chainId, 'chainId differs from handoff');
expect(manifest.sourceCommit === handoff.sourceCommit, 'sourceCommit differs from handoff');
expect(manifest.attestationHash === handoff.attestationHash, 'attestationHash differs from handoff');
expect(JSON.stringify(sortKeys(manifest.network)) === JSON.stringify(sortKeys(network)), 'network block differs from network.json');
expect(Array.isArray(manifest.contracts) && manifest.contracts.length === handoff.contracts.length, 'contract count differs');

for (const c of handoff.contracts) {
  const m = manifest.contracts.find((x) => x.name === c.name);
  if (!m) { problems.push(`contract ${c.name} missing`); continue; }
  expect(m.address === c.address, `${c.name} address differs`);
  expect(m.abiHash === c.abiHash, `${c.name} abiHash differs`);
  expect(/^[a-z0-9_./-]+$/i.test(m.abiPath) && !m.abiPath.includes('..') && !m.abiPath.includes(':'), `${c.name} abiPath is not a relative path`);
  try {
    const abi = JSON.parse(readFileSync(resolve(distDir, m.abiPath), 'utf8'));
    expect(canonicalKeccak(abi) === c.abiHash, `${m.abiPath} content hash differs from handoff abiHash`);
  } catch (e) {
    problems.push(`${m.abiPath}: ${e.message}`);
  }
}

const listed = new Map(manifest.assets.map((a) => [a.path, a.sha256]));
const onDisk = listFiles(distDir).filter((p) => p !== MANIFEST);
for (const path of onDisk) {
  const hash = listed.get(path);
  if (!hash) { problems.push(`unlisted file ${path}`); continue; }
  const actual = sha256Hex(readFileSync(resolve(distDir, path)));
  expect(actual === hash, `hash mismatch for ${path}`);
  expect(/^[0-9a-f]{64}$/.test(hash), `hash for ${path} is not 64 lowercase hex chars`);
}
for (const path of listed.keys()) {
  expect(onDisk.includes(path), `listed asset ${path} does not exist`);
  expect(!path.startsWith('/') && !path.includes('..') && !path.includes('://'), `asset path ${path} is not dist-relative`);
}
expect(!listed.has(MANIFEST), 'manifest must not list itself');
expect(manifest.assets.length <= 128, 'more than 128 assets');

if (problems.length) {
  console.error('verify-dist: FAILED');
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log(`verify-dist: OK (${onDisk.length} assets, ${manifest.contracts.length} contracts)`);
