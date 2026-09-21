import {confirmSignature, type ConfirmOutcome} from "@/lib/confirmSignature";

export interface SwapQuote {
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: number;
  platformFee: {amount: string; feeBps: number} | null;
  routeLabels: string[];
  raw: unknown;
}

export async function fetchQuote(params: {
  inputMint: string;
  outputMint: string;
  amountBase: string;
  slippageBps: number;
}): Promise<SwapQuote> {
  const response = await fetch(
    `/api/quote?inputMint=${params.inputMint}` +
      `&outputMint=${params.outputMint}` +
      `&amount=${params.amountBase}` +
      `&slippageBps=${params.slippageBps}`,
  );
  const body = (await response.json()) as {quote?: SwapQuote; error?: string};
  if (!response.ok || !body.quote) {
    throw new Error(body.error ?? "Could not price this trade.");
  }
  return body.quote;
}

export async function executeSwap(params: {
  quote: SwapQuote;
  wallet: string;
  signAndSend: (bytes: Uint8Array) => Promise<string>;
  onStatus?: (status: string) => void;
}): Promise<{signature: string; outcome: ConfirmOutcome}> {
  params.onStatus?.("Building…");

  const response = await fetch("/api/swap/build", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({quote: params.quote, userPublicKey: params.wallet}),
  });
  const body = (await response.json()) as {
    swap?: {transactionBase64: string};
    error?: string;
  };

  if (!response.ok || !body.swap) {
    throw new Error(body.error ?? "Could not build the transaction.");
  }

  params.onStatus?.("Waiting for your signature…");
  const bytes = Uint8Array.from(atob(body.swap.transactionBase64), (c) =>
    c.charCodeAt(0),
  );
  const signature = await params.signAndSend(bytes);

  params.onStatus?.("Confirming on-chain…");
  const outcome = await confirmSignature(signature);
  return {signature, outcome};
}
