import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {assertPubkey} from "@/lib/pubkey";
import {badRequest, json} from "@/lib/server/http";

const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

const MAX_LAMPORTS = BigInt(Number.MAX_SAFE_INTEGER);

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {from?: string; to?: string; lamports?: string};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("Body must be JSON.");
  }

  let from: ReturnType<typeof assertPubkey>;
  let to: ReturnType<typeof assertPubkey>;
  try {
    from = assertPubkey(body.from, "from");
    to = assertPubkey(body.to, "to");
  } catch (error) {
    return badRequest((error as Error).message);
  }

  if (from === to) return badRequest("Cannot send to the same address.");

  if (!/^\d+$/.test(body.lamports ?? "") || body.lamports === "0") {
    return badRequest("Lamports must be a positive integer.");
  }

  const lamports = BigInt(body.lamports!);
  if (lamports > MAX_LAMPORTS) {
    return badRequest("Amount is too large.");
  }

  try {
    const connection = new Connection(RPC_URL, "confirmed");
    const {blockhash} = await connection.getLatestBlockhash();

    const message = new TransactionMessage({
      payerKey: new PublicKey(from),
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: new PublicKey(from),
          toPubkey: new PublicKey(to),
          lamports: Number(lamports),
        }),
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);

    return json({
      transfer: {
        transactionBase64: Buffer.from(transaction.serialize()).toString("base64"),
      },
    });
  } catch (error) {
    return json({error: (error as Error).message}, {status: 502});
  }
}
