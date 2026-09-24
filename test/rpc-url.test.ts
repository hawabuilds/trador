import assert from "node:assert/strict";
import {afterEach, describe, it} from "node:test";
import {
  resetRpcUrlWarningsForTests,
  walletBalanceRpcUrls,
} from "@/lib/server/rpcUrl";

describe("walletBalanceRpcUrls", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
    resetRpcUrlWarningsForTests();
  });

  it("prefers SOLANA_RPC_URL and excludes INDEXER_RPC_URL", () => {
    process.env = {
      ...env,
      SOLANA_RPC_URL: "https://alchemy.example/rpc",
      INDEXER_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=indexer",
      HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=indexer",
    };
    const urls = walletBalanceRpcUrls();
    assert.equal(urls[0], "https://alchemy.example/rpc");
    assert.ok(!urls.includes(process.env.INDEXER_RPC_URL!));
    assert.ok(!urls.includes(process.env.HELIUS_RPC_URL!));
  });

  it("does not use Helius when it matches the indexer URL", () => {
    const shared = "https://mainnet.helius-rpc.com/?api-key=shared";
    process.env = {
      ...env,
      INDEXER_RPC_URL: shared,
      HELIUS_RPC_URL: shared,
    };
    delete process.env.SOLANA_RPC_URL;
    delete process.env.SERVER_RPC_URL;
    const urls = walletBalanceRpcUrls();
    assert.ok(!urls.includes(shared));
    assert.equal(urls[0], "https://api.mainnet-beta.solana.com");
  });
});
