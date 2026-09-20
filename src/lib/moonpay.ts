"use client";

import {loadMoonPay, type MoonPayWebSdk} from "@moonpay/moonpay-js";

import {
  MOONPAY_API_KEY,
  MOONPAY_BASE_AMOUNT,
  MOONPAY_BASE_CURRENCY,
  MOONPAY_DEFAULT_CRYPTO,
  MOONPAY_ENV,
  isMoonPayEnabled,
} from "@/config/moonpay";

type InitFn = NonNullable<Awaited<ReturnType<typeof loadMoonPay>>>;

let initFnPromise: Promise<InitFn | undefined> | null = null;
let active: MoonPayWebSdk | null = null;

async function getInitFn(): Promise<InitFn> {
  if (!initFnPromise) initFnPromise = loadMoonPay();
  const initFn = await initFnPromise;
  if (!initFn) throw new Error("MoonPay failed to load.");
  return initFn;
}

export async function openMoonPayBuy(
  walletAddress: string,
  options?: {baseCurrencyAmount?: string; quoteCurrencyAmount?: string},
): Promise<void> {
  if (!isMoonPayEnabled) {
    throw new Error("MoonPay is not configured on this deployment.");
  }

  active?.close();

  const moonPay = await getInitFn();

  const useQuote =
    typeof options?.quoteCurrencyAmount === "string" &&
    options.quoteCurrencyAmount !== "" &&
    options.quoteCurrencyAmount !== "0";

  const params = useQuote
    ? {
        apiKey: MOONPAY_API_KEY,
        theme: "dark" as const,
        walletAddress,
        currencyCode: MOONPAY_DEFAULT_CRYPTO,
        quoteCurrencyAmount: options!.quoteCurrencyAmount!,
      }
    : {
        apiKey: MOONPAY_API_KEY,
        theme: "dark" as const,
        walletAddress,
        baseCurrencyCode: MOONPAY_BASE_CURRENCY,
        baseCurrencyAmount: options?.baseCurrencyAmount ?? MOONPAY_BASE_AMOUNT,
        defaultCurrencyCode: MOONPAY_DEFAULT_CRYPTO,
      };

  const moonPaySdk = moonPay({
    flow: "buy",
    environment: MOONPAY_ENV,
    variant: "overlay",
    params,
    handlers: {
      onCloseOverlay: () => {
        moonPaySdk?.close();
        active = null;
      },
    },
  });

  if (!moonPaySdk) throw new Error("MoonPay failed to initialize.");

  const urlForSignature = moonPaySdk.generateUrlForSigning();

  const signRes = await fetch("/api/moonpay/sign", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({urlForSignature}),
  });
  const body = (await signRes.json()) as {signature?: string; error?: string};
  if (!signRes.ok || !body.signature) {
    throw new Error(body.error ?? "Could not prepare MoonPay.");
  }

  moonPaySdk.updateSignature(body.signature);
  active = moonPaySdk;
  moonPaySdk.show();
}
