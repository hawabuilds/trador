import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
  gpaDiscoveryLabel,
  getProgramAccountsV2All,
  resetGpaV2FallbackLogForTests,
  type RpcInvoke,
} from "@/lib/server/getProgramAccountsV2";

describe("getProgramAccountsV2All", () => {
  it("paginates until paginationKey is null", async () => {
    const calls: unknown[][] = [];
    const invoke = (async (method, params) => {
      calls.push([method, params]);
      if (method !== "getProgramAccountsV2") throw new Error("unexpected method");
      const config = params[1] as {paginationKey?: string};
      if (!config.paginationKey) {
        return {
          accounts: [{pubkey: "a", account: {data: ["AA==", "base64"]}}],
          paginationKey: "cursor-1",
        };
      }
      return {
        accounts: [{pubkey: "b", account: {data: ["AQ==", "base64"]}}],
        paginationKey: null,
      };
    }) as RpcInvoke;

    const rows = await getProgramAccountsV2All(invoke, "Prog111", {
      encoding: "base64",
      filters: [{dataSize: 100}],
    });

    assert.equal(rows.length, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual((calls[1][1] as unknown[])[1], {
      encoding: "base64",
      filters: [{dataSize: 100}],
      limit: 5000,
      paginationKey: "cursor-1",
    });
  });

  it("falls back to getProgramAccounts when V2 is missing", async () => {
    resetGpaV2FallbackLogForTests();
    const calls: string[] = [];
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    const invoke = (async (method) => {
      calls.push(method);
      if (method === "getProgramAccountsV2") {
        throw new Error("Method not found");
      }
      return [{pubkey: "legacy", account: {data: ["", "base64"]}}];
    }) as RpcInvoke;

    try {
      const rows = await getProgramAccountsV2All(invoke, "Prog111", {encoding: "base64"});
      assert.equal(rows.length, 1);
      assert.deepEqual(calls, ["getProgramAccountsV2", "getProgramAccounts"]);
      assert.ok(warnings.some((line) => line.includes("falling back to getProgramAccounts")));

      resetGpaV2FallbackLogForTests();
      warnings.length = 0;
      calls.length = 0;
      await getProgramAccountsV2All(invoke, "Prog222", {encoding: "base64"});
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0].includes("Prog222"));
      assert.equal(gpaDiscoveryLabel(), "gpa-v1");
    } finally {
      console.warn = warn;
    }
  });
});
