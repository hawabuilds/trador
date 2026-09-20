import crypto from "node:crypto";

/** MoonPay HMAC-SHA256 over the URL query string (including leading `?`). */
export function signMoonPayUrl(urlForSignature: string, secretKey: string): string {
  const search = new URL(urlForSignature).search;
  if (!search) {
    throw new Error("The URL to sign must include query parameters.");
  }
  return crypto.createHmac("sha256", secretKey).update(search).digest("base64");
}
