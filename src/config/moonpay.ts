export const MOONPAY_API_KEY = process.env.NEXT_PUBLIC_MOONPAY_API_KEY ?? "";

export const MOONPAY_ENV =
  process.env.NEXT_PUBLIC_MOONPAY_ENV === "production" ? "production" : "sandbox";

export const MOONPAY_BASE_CURRENCY = process.env.NEXT_PUBLIC_MOONPAY_BASE_CURRENCY ?? "usd";

export const MOONPAY_BASE_AMOUNT = process.env.NEXT_PUBLIC_MOONPAY_BASE_AMOUNT ?? "100";

/** Pre-selected crypto; customer can still change it in the widget. */
export const MOONPAY_DEFAULT_CRYPTO = process.env.NEXT_PUBLIC_MOONPAY_DEFAULT_CRYPTO ?? "sol";

export const isMoonPayEnabled = Boolean(MOONPAY_API_KEY);
