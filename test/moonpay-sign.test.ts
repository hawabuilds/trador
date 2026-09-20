import assert from "node:assert/strict";
import test from "node:test";

import {signMoonPayUrl} from "@/lib/server/moonpaySign";

test("signMoonPayUrl matches MoonPay documentation test vector", () => {
  const url =
    "https://buy-sandbox.moonpay.com/?apiKey=pk_test_DocsVector00&currencyCode=eth&walletAddress=0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe";
  const signature = signMoonPayUrl(url, "sk_test_DocsVector00");
  assert.equal(signature, "oIJxSghyzll/BLhUFdQZhkxf7DAS8REFaWr/ibO+K8Q=");
});
