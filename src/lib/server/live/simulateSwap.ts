import {Connection, VersionedTransaction} from "@solana/web3.js";

import {serverRpcUrl} from "@/lib/server/rpcUrl";

export type SimulationOutcome =
  | {ok: true}
  | {ok: false; message: string; logs: string[]};

/** Preflight a Jupiter-built transaction with the same RPC the app uses server-side. */
export async function simulateSwapTransaction(
  transactionBase64: string,
): Promise<SimulationOutcome> {
  const connection = new Connection(serverRpcUrl(), "confirmed");
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(transactionBase64, "base64"),
  );

  const result = await connection.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });

  if (!result.value.err) return {ok: true};

  const logs = result.value.logs ?? [];
  return {
    ok: false,
    message: describeSimulationFailure(result.value.err, logs),
    logs,
  };
}

/** Turn RPC simulation output into text the order ticket can show. */
export function describeSimulationFailure(err: unknown, logs: string[]): string {
  const joined = logs.join("\n");
  const errJson = JSON.stringify(err);

  if (/6025|0x1789/i.test(joined) || /6025|0x1789/i.test(errJson)) {
    return "Platform fee account rejected by the router (Jupiter 6025). The fee was dropped or misconfigured.";
  }
  if (/6014|0x177e/i.test(joined)) {
    return "Platform fee token account is missing or wrong mint (Jupiter 6014).";
  }
  if (/6001|0x1771/i.test(joined)) {
    return "Slippage exceeded — refresh the quote and try again.";
  }
  if (/insufficient/i.test(joined)) {
    return "Insufficient SOL for this swap (trade size, rent, or network fees).";
  }
  if (/AccountNotFound/i.test(errJson)) {
    return "Wallet not found or has no SOL — fund the wallet and try again.";
  }

  const interesting = logs.filter((line) =>
    /failed|error|insufficient|custom program error/i.test(line),
  );
  if (interesting.length > 0) {
    return interesting.slice(-3).join(" ");
  }

  return `Transaction simulation failed: ${errJson}`;
}
