import type { AbiEvent, Address, Log, PublicClient } from 'viem';

export interface ChunkedLogOptions {
  address: Address;
  event: AbiEvent;
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
  /** Initial block span per eth_getLogs call; halved on RPC errors down to minChunk. */
  chunkSize?: bigint;
  minChunk?: bigint;
}

/**
 * Reads logs in bounded block ranges from the deployment block. Public RPCs cap the span of a
 * single eth_getLogs call, so a failing range is retried with half the span before giving up.
 */
export async function getLogsChunked(client: PublicClient, options: ChunkedLogOptions): Promise<Log[]> {
  const minChunk = options.minChunk ?? 500n;
  let chunk = options.chunkSize ?? 20_000n;
  const out: Log[] = [];
  let from = options.fromBlock;
  while (from <= options.toBlock) {
    const to = from + chunk - 1n > options.toBlock ? options.toBlock : from + chunk - 1n;
    try {
      const logs = await client.getLogs({
        address: options.address,
        event: options.event,
        args: options.args as never,
        fromBlock: from,
        toBlock: to,
        strict: true,
      });
      out.push(...logs);
      from = to + 1n;
    } catch (error) {
      if (chunk <= minChunk) throw error;
      chunk = chunk / 2n < minChunk ? minChunk : chunk / 2n;
    }
  }
  return out;
}
