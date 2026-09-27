import { describe, expect, it } from 'vitest';
import { buildWalletAddChain, canonicalAbiHash, loadDeployment, validateManifest } from '../src/deployment';
import { daemonSponsorPoolAbi, launchTokenAbi } from '../src/generated/abis';
import { BASE_URL, abiFiles, buildManifest, defaultFiles, fakeFetch, handoff, networkFile } from './harness';

describe('runtime deployment configuration', () => {
  it('loads the manifest and ABI files next to index.html and checks every ABI hash', async () => {
    const d = await loadDeployment({ fetchImpl: fakeFetch(defaultFiles()), baseUrl: BASE_URL });
    expect(d.pool.address).toBe(handoff.contracts.find((c) => c.name === 'DaemonSponsorPool')!.address);
    expect(d.token.address).toBe(handoff.contracts.find((c) => c.name === 'LaunchToken')!.address);
    expect(d.chain.id).toBe(handoff.chainId);
    expect(d.chain.rpcUrls.default.http).toEqual(networkFile.network['rpcUrls']);
    expect(d.explorer.address(d.pool.address)).toBe(`${networkFile.network['explorer']}/address/${d.pool.address}`);
    expect(canonicalAbiHash(d.pool.abi)).toBe(handoff.contracts.find((c) => c.name === 'DaemonSponsorPool')!.abiHash);
  });

  it('derives wallet_addEthereumChain parameters identical to the vetted walletAddChain block', () => {
    const derived = buildWalletAddChain(validateManifest(buildManifest()).network);
    expect(JSON.stringify(derived)).toBe(JSON.stringify(networkFile.walletAddChain));
  });

  it('refuses an ABI whose hash differs from the attested hash', async () => {
    const files = defaultFiles();
    const tampered = JSON.parse(abiFiles['DaemonSponsorPool']!) as unknown[];
    tampered.pop();
    files['abi/DaemonSponsorPool.json'] = JSON.stringify(tampered);
    await expect(loadDeployment({ fetchImpl: fakeFetch(files), baseUrl: BASE_URL })).rejects.toThrow(/does not match the attested ABI hash/);
  });

  it('refuses a manifest with a missing ABI file or malformed fields', async () => {
    const files = defaultFiles();
    delete files['abi/LaunchToken.json'];
    await expect(loadDeployment({ fetchImpl: fakeFetch(files), baseUrl: BASE_URL })).rejects.toThrow(/HTTP 404/);
    expect(() => validateManifest(buildManifest({ version: 2 }))).toThrow(/version/);
    expect(() => validateManifest(buildManifest({ network: { ...networkFile.network, chainId: 1 } }))).toThrow(/disagrees/);
    expect(() => validateManifest(buildManifest({ contracts: [] }))).toThrow(/empty/);
    const badPath = buildManifest();
    badPath.contracts[0]!.abiPath = '../abi/x.json';
    expect(() => validateManifest(badPath)).toThrow(/malformed/);
  });

  it('keeps the generated TypeScript ABI constants in sync with docs/abi', () => {
    expect(canonicalAbiHash(daemonSponsorPoolAbi)).toBe(handoff.contracts.find((c) => c.name === 'DaemonSponsorPool')!.abiHash);
    expect(canonicalAbiHash(launchTokenAbi)).toBe(handoff.contracts.find((c) => c.name === 'LaunchToken')!.abiHash);
  });
});
