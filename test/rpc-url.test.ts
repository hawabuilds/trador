import assert from "node:assert/strict";
import {afterEach, describe, it} from "node:test";
import {
  indexerRpcUrl,
  resetRpcUrlWarningsForTests,
  serverRpcUrl,
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

describe("serverRpcUrl", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
    resetRpcUrlWarningsForTests();
  });

  it("prefers SOLANA_RPC_URL over HELIUS when both are set (Vercel split keys)", () => {
    process.env = {
      ...env,
      SOLANA_RPC_URL: "https://alchemy.example/rpc",
      HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=indexer",
    };
    delete process.env.SERVER_RPC_URL;
    delete process.env.INDEXER_RPC_URL;
    assert.equal(serverRpcUrl(), "https://alchemy.example/rpc");
  });

  it("falls back to SOLANA_RPC_URL when only that is set", () => {
    process.env = {...env, SOLANA_RPC_URL: "https://alchemy.example/rpc"};
    delete process.env.SERVER_RPC_URL;
    delete process.env.HELIUS_RPC_URL;
    delete process.env.INDEXER_RPC_URL;
    assert.equal(serverRpcUrl(), "https://alchemy.example/rpc");
  });

  it("skips HELIUS when it matches INDEXER_RPC_URL", () => {
    const shared = "https://mainnet.helius-rpc.com/?api-key=shared";
    process.env = {
      ...env,
      INDEXER_RPC_URL: shared,
      HELIUS_RPC_URL: shared,
      SOLANA_RPC_URL: "https://alchemy.example/rpc",
    };
    delete process.env.SERVER_RPC_URL;
    assert.equal(serverRpcUrl(), "https://alchemy.example/rpc");
  });
});

describe("indexerRpcUrl", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("uses HELIUS_RPC_URL when INDEXER_RPC_URL is unset", () => {
    process.env = {
      ...env,
      HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=worker",
    };
    delete process.env.INDEXER_RPC_URL;
    delete process.env.SOLANA_RPC_URL;
    assert.equal(
      indexerRpcUrl(),
      "https://mainnet.helius-rpc.com/?api-key=worker",
    );
  });

  it("prefers INDEXER_RPC_URL over HELIUS_RPC_URL", () => {
    process.env = {
      ...env,
      INDEXER_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=indexer",
      HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=other",
    };
    assert.equal(
      indexerRpcUrl(),
      "https://mainnet.helius-rpc.com/?api-key=indexer",
    );
  });
});
