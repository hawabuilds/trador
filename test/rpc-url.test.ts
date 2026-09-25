import assert from "node:assert/strict";
import {afterEach, describe, it} from "node:test";
import {heliusKey} from "@/lib/server/live/helius";
import {
  indexerRpcUrl,
  resetRpcUrlWarningsForTests,
  serverRpcUrl,
  sharesIndexerHeliusKey,
  signatureListRpcUrls,
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

describe("signatureListRpcUrls", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("puts RAW_TX first and skips Helius when it is the indexer key", () => {
    const indexer = "https://mainnet.helius-rpc.com/?api-key=indexer";
    process.env = {
      ...env,
      RAW_TX_RPC_URL: "https://alchemy.example/rpc",
      INDEXER_RPC_URL: indexer,
      HELIUS_RPC_URL: indexer,
    };
    const urls = signatureListRpcUrls();
    assert.equal(urls[0], "https://alchemy.example/rpc");
    assert.ok(urls.includes("https://api.mainnet-beta.solana.com"));
    assert.ok(!urls.includes(indexer));
  });

  it("keeps a separate Helius key as last resort", () => {
    process.env = {
      ...env,
      RAW_TX_RPC_URL: "https://alchemy.example/rpc",
      INDEXER_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=indexer",
      HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=parse",
    };
    const urls = signatureListRpcUrls();
    assert.ok(urls.includes("https://mainnet.helius-rpc.com/?api-key=parse"));
    assert.ok(!urls.includes("https://mainnet.helius-rpc.com/?api-key=indexer"));
  });

  it("skips Helius when only the api-key matches the indexer URL", () => {
    process.env = {
      ...env,
      RAW_TX_RPC_URL: "https://alchemy.example/rpc",
      INDEXER_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=shared",
      HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/rpc?api-key=shared",
    };
    const urls = signatureListRpcUrls();
    assert.ok(!urls.some((url) => url.includes("api-key=shared")));
  });
});

describe("heliusKey vs indexer", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("returns null when HELIUS_RPC_URL shares the indexer api-key", () => {
    process.env = {
      ...env,
      INDEXER_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=shared",
      HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/rpc?api-key=shared",
    };
    delete process.env.HELIUS_API_KEY;
    assert.equal(heliusKey(), null);
    assert.equal(sharesIndexerHeliusKey("shared"), true);
  });

  it("keeps a distinct parse key", () => {
    process.env = {
      ...env,
      INDEXER_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=indexer",
      HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=parse",
    };
    delete process.env.HELIUS_API_KEY;
    assert.equal(heliusKey(), "parse");
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
