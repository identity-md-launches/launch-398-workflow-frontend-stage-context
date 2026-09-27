import type { Deployment } from '../deployment';
import { formatAmount, formatSpon, shortAddress } from '../format';
import { useLaunchQuote } from '../hooks';
import { LAUNCH_POOL, launchPoolId, type PoolSnapshot } from '../reads';
import { Card, ExternalLink, Reason, Stat, StatList } from './ui';

export function GetSponCard({ deployment, snapshot }: { deployment: Deployment; snapshot: PoolSnapshot | undefined }) {
  const quote = useLaunchQuote(deployment, snapshot?.tokenAddress, snapshot?.bond);
  const decimals = snapshot?.tokenDecimals ?? 18;
  const v4 = deployment.network.uniswapV4;
  const eth = deployment.network.nativeCurrency.symbol;
  return (
    <Card id="get-spon" title="Get SPON" description={`SPON comes from swapping ${deployment.network.name} ${eth} in the launch pool on Uniswap v4. This page does not swap; use a Uniswap interface or wallet swap with the pool details below.`}>
      <StatList>
        <Stat
          label={`0.01 ${eth} buys`}
          value={quote.data ? `≈ ${formatSpon(quote.data.sponOut, decimals)}` : quote.isError ? 'Quote unavailable' : 'Quoting…'}
          hint={quote.data ? 'Live quote from the launch pool, before slippage and gas.' : quote.isError ? 'The quoter call reverted; the pool may be empty or the RPC is busy.' : undefined}
        />
        <Stat
          label="Bond of 100,000 SPON costs"
          value={quote.data ? (quote.data.bondEthCost !== null ? `≈ ${formatAmount(quote.data.bondEthCost, 18, 5)} ${eth}` : 'Not quotable') : quote.isError ? '—' : 'Quoting…'}
          hint={quote.data?.bondEthCost !== null && quote.data ? 'Exact-output quote before slippage and gas.' : undefined}
        />
      </StatList>
      <dl className="kv">
        <div>
          <dt>Pool</dt>
          <dd>
            {eth} / SPON, fee {(LAUNCH_POOL.fee / 10_000).toFixed(2)}%, tick spacing {LAUNCH_POOL.tickSpacing}, no hook
          </dd>
        </div>
        {snapshot ? (
          <div>
            <dt>Pool ID</dt>
            <dd className="mono" translate="no">
              {launchPoolId(snapshot.tokenAddress)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Pool manager</dt>
          <dd className="mono" translate="no">
            <ExternalLink href={deployment.explorer.address(v4.poolManager)}>{shortAddress(v4.poolManager)}</ExternalLink>
          </dd>
        </div>
        <div>
          <dt>Universal router</dt>
          <dd className="mono" translate="no">
            <ExternalLink href={deployment.explorer.address(v4.universalRouter)}>{shortAddress(v4.universalRouter)}</ExternalLink>
          </dd>
        </div>
        <div>
          <dt>Quoter</dt>
          <dd className="mono" translate="no">
            <ExternalLink href={deployment.explorer.address(v4.quoter)}>{shortAddress(v4.quoter)}</ExternalLink>
          </dd>
        </div>
      </dl>
      {deployment.network.testnet && deployment.network.faucets.length > 0 ? (
        <Reason>
          Need test {eth}? Faucets: {deployment.network.faucets.map((f, i) => (
            <span key={f}>
              {i > 0 ? ', ' : ''}
              <ExternalLink href={f}>{new URL(f).hostname}</ExternalLink>
            </span>
          ))}
          .
        </Reason>
      ) : null}
    </Card>
  );
}
