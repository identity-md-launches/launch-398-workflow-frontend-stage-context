// Interaction tests against the mocked wallet and RPC. Nothing here touches a network.
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { encodeFunctionData } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonSponsorPoolAbi } from '../src/generated/abis';
import { ALICE, POOL, buildManifest, createChain, defaultFiles, networkFile, renderApp } from './harness';
import { BOND, EPOCH } from './mockChain';

afterEach(() => cleanup());

const user = () => userEvent.setup();

async function connect(chain: ReturnType<typeof createChain>) {
  const button = await screen.findByRole('button', { name: /connect mock wallet/i }, { timeout: 8000 });
  await user().click(button);
  await screen.findByText('0x1111…1111', {}, { timeout: 8000 });
  return chain;
}

describe('page load and disconnected state', () => {
  it('shows live contract state and disables every action until a wallet is connected', async () => {
    const chain = createChain();
    renderApp(chain);
    await screen.findByRole('heading', { level: 1, name: 'Daemon Sponsor' }, { timeout: 8000 });
    expect(await screen.findByRole('button', { name: /connect mock wallet/i })).toBeInTheDocument();

    const epoch = within(await screen.findByRole('region', { name: 'Current epoch' }));
    await epoch.findByText('#0', {}, { timeout: 8000 });
    expect(epoch.getByText('Not opened yet')).toBeInTheDocument();
    expect(epoch.getByText(/Ends in/)).toBeInTheDocument();

    const worker = within(screen.getByRole('region', { name: 'Worker' }));
    expect(worker.getByRole('button', { name: /approve 100,000 spon/i })).toBeDisabled();
    expect(worker.getByRole('button', { name: /register worker/i })).toBeDisabled();
    expect(worker.getAllByText('Connect a wallet to use this action.').length).toBeGreaterThan(0);

    const sponsor = within(screen.getByRole('region', { name: 'Sponsor' }));
    expect(sponsor.getByRole('button', { name: /sponsor the pool/i })).toBeDisabled();

    const contracts = within(screen.getByRole('region', { name: 'Contracts' }));
    expect(contracts.getByRole('link', { name: new RegExp(POOL, 'i') })).toHaveAttribute('href', `${networkFile.network['explorer']}/address/${POOL}`);
    expect(screen.getByRole('region', { name: 'Get SPON' })).toHaveTextContent(/swapping Sepolia ETH in the launch pool/);
  });

  it('refuses to start when the deployment file fails validation', async () => {
    const chain = createChain();
    const files = defaultFiles(buildManifest({ attestationHash: 'nope' }));
    renderApp(chain, files);
    expect(await screen.findByRole('alert')).toHaveTextContent(/attestationHash/);
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
  });

  it('reports a cancelled wallet connection without crashing', async () => {
    const chain = createChain();
    chain.rejectNext = true;
    renderApp(chain);
    await user().click(await screen.findByRole('button', { name: /connect mock wallet/i }, { timeout: 8000 }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled in the wallet/i);
  });
});

describe('wrong network', () => {
  it('offers a single switch control and adds the chain with the vetted parameters when the wallet lacks it', async () => {
    const chain = createChain({ walletChainId: 1, knownChains: [1] });
    renderApp(chain);
    await connect(chain);
    const switchButton = await screen.findByRole('button', { name: 'Switch to Sepolia' });
    expect(screen.getAllByRole('button', { name: 'Switch to Sepolia' })).toHaveLength(1);
    const worker = within(screen.getByRole('region', { name: 'Worker' }));
    expect(await worker.findByText(/switch the wallet to sepolia/i)).toBeInTheDocument();
    expect(worker.getByRole('button', { name: /register worker/i })).toBeDisabled();

    await user().click(switchButton);
    await waitFor(() => expect(chain.walletChainId).toBe(11155111));
    const methods = chain.requests.map((r) => r.method);
    const firstSwitch = methods.indexOf('wallet_switchEthereumChain');
    const add = methods.indexOf('wallet_addEthereumChain');
    expect(firstSwitch).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(firstSwitch);
    expect(methods.lastIndexOf('wallet_switchEthereumChain')).toBeGreaterThan(add);
    expect(chain.requests[add]!.params).toEqual([networkFile.walletAddChain]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Switch to Sepolia' })).not.toBeInTheDocument());
    expect(screen.getByText('Sepolia', { selector: '.chain-pill' })).toBeInTheDocument();
  });
});

describe('worker lifecycle', () => {
  it('approves, registers, checks in, blocks a second check-in, then sponsors', async () => {
    const chain = createChain();
    renderApp(chain);
    await connect(chain);

    const wallet = within(screen.getByRole('region', { name: 'Your wallet' }));
    await wallet.findByText('250,000 SPON', {}, { timeout: 8000 });

    const worker = within(screen.getByRole('region', { name: 'Worker' }));
    const approve = await worker.findByRole('button', { name: /approve 100,000 spon/i });
    await waitFor(() => expect(approve).toBeEnabled());
    expect(worker.getByRole('button', { name: /register worker/i })).toBeDisabled();
    expect(worker.getByText('Approve the bond first.')).toBeInTheDocument();

    await user().click(approve);
    await screen.findByText('Confirmed.', {}, { timeout: 8000 });
    await waitFor(() => expect(worker.getByRole('button', { name: /register worker/i })).toBeEnabled(), { timeout: 8000 });
    await wallet.findByText('100,000 SPON', {}, { timeout: 8000 });

    await user().click(worker.getByRole('button', { name: /register worker/i }));
    await waitFor(() => expect(worker.getByText('Registered')).toBeInTheDocument(), { timeout: 8000 });
    expect(chain.balanceOf(ALICE)).toBe(150_000n * 10n ** 18n);
    expect(chain.state.totalBonds).toBe(BOND);

    const checkIn = await worker.findByRole('button', { name: /check in to epoch #0/i });
    await user().click(checkIn);
    await waitFor(() => expect(worker.getByText(/already checked in this epoch/i)).toBeInTheDocument(), { timeout: 8000 });
    expect(worker.getByRole('button', { name: /check in to epoch #0/i })).toBeDisabled();
    const epoch = within(screen.getByRole('region', { name: 'Current epoch' }));
    await waitFor(() => expect(epoch.getByText('Open')).toBeInTheDocument(), { timeout: 8000 });

    // Sponsor 7,000 SPON: approve step, then the gift.
    const sponsor = within(screen.getByRole('region', { name: 'Sponsor' }));
    await user().type(sponsor.getByLabelText(/amount to sponsor/i), '7000');
    const approveGift = sponsor.getByRole('button', { name: /approve 7,000 spon/i });
    expect(sponsor.getByRole('button', { name: /sponsor 7,000 spon/i })).toBeDisabled();
    await user().click(approveGift);
    await waitFor(() => expect(sponsor.getByRole('button', { name: /sponsor 7,000 spon/i })).toBeEnabled(), { timeout: 8000 });
    await user().click(sponsor.getByRole('button', { name: /sponsor 7,000 spon/i }));
    await waitFor(() => expect(chain.state.pool).toBe(7_000n * 10n ** 18n), { timeout: 8000 });
    await epoch.findByText('7,000 SPON', {}, { timeout: 8000 });
  });

  it('shows a decoded revert reason and a wallet rejection without sending anything', async () => {
    const chain = createChain();
    // Pre-approve so the page believes registration is possible, then make the contract reject it.
    chain.state.allowances.set(`${ALICE.toLowerCase()}:${POOL.toLowerCase()}`, BOND);
    chain.state.bondOf.set(ALICE.toLowerCase(), BOND); // bond already held -> BondAlreadyHeld on register
    chain.state.isRegistered.set(ALICE.toLowerCase(), false);
    chain.state.bondUnlockEpoch.set(ALICE.toLowerCase(), 5n);
    renderApp(chain);
    await connect(chain);
    const worker = within(screen.getByRole('region', { name: 'Worker' }));
    await worker.findByText('Deregistered', {}, { timeout: 8000 });
    const withdraw = worker.getByRole('button', { name: /withdraw bond/i });
    expect(withdraw).toBeDisabled();
    expect(worker.getByText(/unlocks at epoch #5/i)).toBeInTheDocument();

    // Force the locked state past the UI gate to prove the simulation catches it.
    chain.state.bondUnlockEpoch.set(ALICE.toLowerCase(), 0n);
    chain.mineBlock();
    await waitFor(() => expect(worker.getByRole('button', { name: /withdraw bond/i })).toBeEnabled(), { timeout: 8000 });
    chain.state.bondUnlockEpoch.set(ALICE.toLowerCase(), 9n);
    await user().click(worker.getByRole('button', { name: /withdraw bond/i }));
    expect(await screen.findByRole('alert', {}, { timeout: 8000 })).toHaveTextContent(/bond stays locked/i);
    expect(chain.requests.some((r) => r.method === 'eth_sendTransaction')).toBe(false);

    // User rejects in the wallet.
    await user().click(screen.getByRole('button', { name: 'Dismiss' }));
    chain.state.bondUnlockEpoch.set(ALICE.toLowerCase(), 0n);
    chain.mineBlock();
    await waitFor(() => expect(worker.getByRole('button', { name: /withdraw bond/i })).toBeEnabled(), { timeout: 8000 });
    chain.rejectNext = true;
    await user().click(worker.getByRole('button', { name: /withdraw bond/i }));
    expect(await screen.findByRole('alert', {}, { timeout: 8000 })).toHaveTextContent(/cancelled in the wallet/i);
    expect(chain.state.bondOf.get(ALICE.toLowerCase())).toBe(BOND);
  });

  it('lists past epochs from events, claims a share, then deregisters and withdraws the bond', async () => {
    const chain = createChain();
    chain.state.allowances.set(`${ALICE.toLowerCase()}:${POOL.toLowerCase()}`, BOND);
    renderApp(chain);
    await connect(chain);
    const worker = within(screen.getByRole('region', { name: 'Worker' }));
    await waitFor(() => expect(worker.getByRole('button', { name: /register worker/i })).toBeEnabled(), { timeout: 8000 });
    await user().click(worker.getByRole('button', { name: /register worker/i }));
    await worker.findByText('Registered', {}, { timeout: 8000 });

    // A sponsor gifts 70,000 SPON before the boundary so epoch 1 gets a 10,000 budget.
    const sponsorAddr = '0x2222222222222222222222222222222222222222';
    chain.state.balances.set(sponsorAddr, 70_000n * 10n ** 18n);
    chain.state.allowances.set(`${sponsorAddr}:${POOL.toLowerCase()}`, 70_000n * 10n ** 18n);
    await chain.provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: sponsorAddr, to: POOL, data: encodeFunctionData({ abi: daemonSponsorPoolAbi, functionName: 'sponsor', args: [70_000n * 10n ** 18n] }) }],
    } as never);
    chain.advanceTime(EPOCH);
    await waitFor(() => expect(worker.getByRole('button', { name: /check in to epoch #1/i })).toBeEnabled(), { timeout: 8000 });
    await user().click(worker.getByRole('button', { name: /check in to epoch #1/i }));
    await waitFor(() => expect(worker.getByText(/already checked in/i)).toBeInTheDocument(), { timeout: 8000 });
    expect(chain.state.epochs.get('1')!.budget).toBe(10_000n * 10n ** 18n);

    chain.advanceTime(EPOCH);
    const history = within(screen.getByRole('region', { name: 'Past epochs' }));
    const claim = await history.findByRole('button', { name: /^Claim / }, { timeout: 8000 });
    const row = claim.closest('tr')!;
    expect(row).toHaveTextContent('#1');
    expect(row).toHaveTextContent('10,000 SPON');
    expect(row).toHaveTextContent('Ended');
    await user().click(claim);
    await waitFor(() => expect(within(row).getByText('Claimed')).toBeInTheDocument(), { timeout: 8000 });
    expect(chain.balanceOf(ALICE)).toBe(160_000n * 10n ** 18n);

    // Deregister needs confirmation, then the bond unlocks next epoch.
    await user().click(worker.getByRole('button', { name: 'Deregister…' }));
    expect(worker.getByText(/deregister this worker\?/i)).toBeInTheDocument();
    await user().click(worker.getByRole('button', { name: 'Cancel' }));
    expect(worker.queryByText(/deregister this worker\?/i)).not.toBeInTheDocument();
    await user().click(worker.getByRole('button', { name: 'Deregister…' }));
    await user().click(worker.getByRole('button', { name: 'Deregister worker' }));
    await worker.findByText('Deregistered', {}, { timeout: 8000 });
    expect(worker.getByRole('button', { name: /withdraw bond/i })).toBeDisabled();
    expect(worker.getByText(/unlocks at epoch #3/i)).toBeInTheDocument();
    chain.advanceTime(EPOCH);
    await waitFor(() => expect(worker.getByRole('button', { name: /withdraw bond/i })).toBeEnabled(), { timeout: 8000 });
    await user().click(worker.getByRole('button', { name: /withdraw bond/i }));
    await waitFor(() => expect(chain.balanceOf(ALICE)).toBe(260_000n * 10n ** 18n), { timeout: 8000 });
    await worker.findByRole('button', { name: /approve 100,000 spon/i }, { timeout: 8000 });
  });
});
