/**
 * Read the handful of mainnet accounts that decide how Trador gets built.
 *
 * Three questions, in order of how much they change the plan:
 *
 *   1. Does StonkFun's platform config permit a third party to launch under it?
 *      LaunchLab's `PlatformConfig` carries restriction flags and a curve-rule
 *      manager. If StonkFun's config is locked, "launch a StonkFun coin from
 *      Trador" is not a feature that exists, and the Create button's StonkFun
 *      half becomes either a handoff or Trador running its own platform config
 *      — which would make Trador a launchpad, a different product.
 *
 *   2. Is the published `LaunchpadPool` layout the deployed one? Every offset
 *      in `LAUNCHPAD_POOL` is computed from Raydium's alpha SDK rather than
 *      observed. If `VestingSchedule` is not five u64s, everything past byte
 *      101 shifts and the universe mis-attributes silently — presenting as an
 *      empty feed, which is the hardest failure to attribute to a layout.
 *
 *   3. What does pump.fun's global config actually say right now — in
 *      particular whether creation is enabled.
 *
 * Deliberately dependency-free: raw JSON-RPC over `fetch` and this repo's own
 * base58. It has to be runnable before `npm install` succeeds, because what it
 * finds determines which SDKs are worth installing.
 *
 *   npm run probe:accounts
 */

import {
  LAUNCHPAD_POOL,
  PUMP_GLOBAL,
  PUMP_PROGRAM,
  RAYDIUM_LAUNCHPAD,
  STONKFUN_PLATFORMS,
  STONKFUN_LAUNCHER,
} from "@/lib/programs";
import {type Pubkey, encodeBase58, isPubkey, readPubkeyAt, shortPubkey} from "@/lib/pubkey";
import {STOCK_MINTS, stockForMint} from "@/lib/stocks/registry";

const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

let rpcCalls = 0;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  rpcCalls += 1;
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: rpcCalls, method, params}),
  });

  if (!response.ok) {
    throw new Error(`${method} → HTTP ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as {result?: T; error?: {message: string; code: number}};
  if (body.error) throw new Error(`${method} → ${body.error.code} ${body.error.message}`);
  return body.result as T;
}

interface AccountInfo {
  owner: string;
  lamports: number;
  executable: boolean;
  data: [string, string];
}

async function getAccount(address: Pubkey): Promise<AccountInfo | null> {
  const result = await rpc<{value: AccountInfo | null}>("getAccountInfo", [
    address,
    {encoding: "base64", commitment: "confirmed"},
  ]);
  return result.value;
}

function decodeData(info: AccountInfo): Uint8Array {
  return Uint8Array.from(Buffer.from(info.data[0], "base64"));
}

function hexDump(data: Uint8Array, limit = 256): string {
  const lines: string[] = [];
  for (let offset = 0; offset < Math.min(data.length, limit); offset += 16) {
    const slice = data.subarray(offset, offset + 16);
    const hex = [...slice].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = [...slice]
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
      .join("");
    lines.push(`    ${offset.toString().padStart(4)}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (data.length > limit) lines.push(`    … ${data.length - limit} more bytes`);
  return lines.join("\n");
}

/** Pull printable runs out of an account, which is how the `name` field shows up. */
function asciiRuns(data: Uint8Array, min = 4): string[] {
  const runs: string[] = [];
  let current = "";
  for (const byte of data) {
    if (byte >= 0x20 && byte < 0x7f) {
      current += String.fromCharCode(byte);
    } else {
      if (current.length >= min) runs.push(current);
      current = "";
    }
  }
  if (current.length >= min) runs.push(current);
  return runs;
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  if (offset + 8 > data.length) return 0n;
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) value = (value << 8n) | BigInt(data[offset + i]);
  return value;
}

function heading(text: string): void {
  console.log(`\n${"─".repeat(72)}\n${text}\n${"─".repeat(72)}`);
}

// ---------------------------------------------------------------------------
// 1. StonkFun platform configs
// ---------------------------------------------------------------------------

async function probeStonkfunPlatforms(): Promise<void> {
  heading("1. StonkFun platform configs — can Trador launch under them?");

  for (const platform of STONKFUN_PLATFORMS) {
    console.log(`\n  ${platform.kind}: ${platform.platformId}`);

    const info = await getAccount(platform.platformId);
    if (!info) {
      console.log("    ✖ account does not exist — the platform id is wrong");
      continue;
    }

    const data = decodeData(info);
    const ownedByLaunchpad = info.owner === RAYDIUM_LAUNCHPAD;

    console.log(`    owner      ${info.owner}${ownedByLaunchpad ? "  ✔ LaunchLab" : "  ✖ NOT LaunchLab"}`);
    console.log(`    size       ${data.length} bytes`);
    console.log(`    lamports   ${info.lamports}`);

    const names = asciiRuns(data).filter((run) => /[A-Za-z]{3}/.test(run));
    if (names.length > 0) {
      console.log(`    strings    ${names.slice(0, 6).map((n) => JSON.stringify(n)).join(", ")}`);
      const looksRight = names.some((n) => /stonk/i.test(n));
      console.log(
        looksRight
          ? "    ✔ a string in this account mentions StonkFun"
          : "    ⚠ nothing here names StonkFun — verify the platform id",
      );
    }

    // The restriction flags are u8s whose offsets the alpha SDK does not pin
    // reliably, so print every byte that is 0 or 1 in the tail of the fixed
    // header and let a human match them against the IDL rather than pretending
    // to know which is which.
    const flagBytes = [...data.subarray(8, 80)]
      .map((byte, index) => ({offset: index + 8, byte}))
      .filter((entry) => entry.byte <= 1);
    if (flagBytes.length > 0) {
      console.log(
        `    0/1 bytes  ${flagBytes
          .map((entry) => `@${entry.offset}=${entry.byte}`)
          .join(" ")}`,
      );
      console.log(
        "    → match these against PlatformConfig's restrictGlobalConfig /",
      );
      console.log(
        "      restrictCurveParam in the IDL. Any 1 is a gate to investigate.",
      );
    }

    console.log(hexDump(data, 192));
  }

  console.log(`\n  StonkFun launcher wallet ${STONKFUN_LAUNCHER}`);
  const launcher = await getAccount(STONKFUN_LAUNCHER);
  console.log(
    launcher
      ? `    exists, ${launcher.lamports} lamports, owner ${shortPubkey(launcher.owner, 6, 6)}`
      : "    ✖ not found",
  );
}

// ---------------------------------------------------------------------------
// 2. A real LaunchpadPool, to pin the layout
// ---------------------------------------------------------------------------

async function probeLaunchpadPool(): Promise<Uint8Array | null> {
  heading("2. A real StonkFun LaunchpadPool — does the published layout hold?");

  for (const platform of STONKFUN_PLATFORMS) {
    console.log(`\n  searching ${platform.kind} launches…`);

    let accounts: {pubkey: string; account: AccountInfo}[];
    try {
      accounts = await rpc<{pubkey: string; account: AccountInfo}[]>(
        "getProgramAccounts",
        [
          RAYDIUM_LAUNCHPAD,
          {
            encoding: "base64",
            commitment: "confirmed",
            filters: [
              {dataSize: LAUNCHPAD_POOL.SPAN},
              {memcmp: {offset: LAUNCHPAD_POOL.PLATFORM_ID, bytes: platform.platformId}},
            ],
          },
        ],
      );
    } catch (error) {
      console.log(`    ✖ getProgramAccounts failed: ${(error as Error).message}`);
      console.log("    → public RPCs often refuse this. Set HELIUS_RPC_URL and retry.");
      continue;
    }

    if (accounts.length === 0) {
      console.log(
        `    no pools at dataSize ${LAUNCHPAD_POOL.SPAN} with platformId at ` +
          `offset ${LAUNCHPAD_POOL.PLATFORM_ID}.`,
      );
      console.log(
        "    → EITHER the span is wrong OR the platformId offset is wrong. " +
          "Retry without the dataSize filter to learn the real span.",
      );
      continue;
    }

    console.log(`    ✔ ${accounts.length} pool(s) found — the layout assumption holds`);

    const sample = accounts[0];
    const data = decodeData(sample.account);
    console.log(`\n    sample pool ${sample.pubkey}`);
    console.log(`    size        ${data.length} (expected ${LAUNCHPAD_POOL.SPAN})`);

    const mintA = readPubkeyAt(data, LAUNCHPAD_POOL.MINT_A);
    const mintB = readPubkeyAt(data, LAUNCHPAD_POOL.MINT_B);
    const configId = readPubkeyAt(data, LAUNCHPAD_POOL.CONFIG_ID);
    const platformId = readPubkeyAt(data, LAUNCHPAD_POOL.PLATFORM_ID);
    const creator = readPubkeyAt(data, LAUNCHPAD_POOL.CREATOR);

    console.log(`    status      ${data[LAUNCHPAD_POOL.STATUS]}`);
    console.log(`    virtualA    ${readU64LE(data, LAUNCHPAD_POOL.VIRTUAL_A)}`);
    console.log(`    virtualB    ${readU64LE(data, LAUNCHPAD_POOL.VIRTUAL_B)}`);
    console.log(`    configId    ${configId}`);
    console.log(`    platformId  ${platformId}${platformId === platform.platformId ? "  ✔ matches" : "  ✖ MISMATCH"}`);
    console.log(`    mintA       ${mintA}${mintA && isPubkey(mintA) ? "" : "  ✖ not an address"}`);
    console.log(`    mintB       ${mintB}${mintB && isPubkey(mintB) ? "" : "  ✖ not an address"}`);
    console.log(`    creator     ${creator}`);

    // The payoff: is the quote side a tokenized stock we know?
    for (const [label, mint] of [["mintA", mintA], ["mintB", mintB]] as const) {
      const stock = mint ? stockForMint(mint) : null;
      if (stock) {
        console.log(`    → ${label} is ${stock.ticker} (${stock.name}) — a stock-paired launch`);
      }
    }

    console.log("");
    console.log(hexDump(data, 448));
    return data;
  }

  return null;
}

// ---------------------------------------------------------------------------
// 3. pump.fun global config
// ---------------------------------------------------------------------------

async function probePump(): Promise<void> {
  heading("3. pump.fun global config");

  const info = await getAccount(PUMP_GLOBAL);
  if (!info) {
    console.log("  ✖ global config not found");
    return;
  }

  const data = decodeData(info);
  console.log(`  owner  ${info.owner}${info.owner === PUMP_PROGRAM ? "  ✔ pump" : "  ✖ not pump"}`);
  console.log(`  size   ${data.length} bytes`);
  console.log(`  disc   ${[...data.subarray(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
  console.log("");
  console.log(hexDump(data, 320));
  console.log(
    "\n  → Custom Pairs are NOT visible from this account. To settle the " +
      "\n    bonding-curve-v2 hypothesis, run:  npm run probe:pump -- <mint>" +
      "\n    with the mint of a coin you know is stock-paired on pump.fun.",
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Trador account probe`);
  console.log(`RPC  ${RPC_URL.replace(/api[-_]?key=[^&]+/i, "api-key=***")}`);
  console.log(`Stock registry: ${STOCK_MINTS.length} mints`);

  await probeStonkfunPlatforms();
  const pool = await probeLaunchpadPool();
  await probePump();

  heading("What this means");

  if (!pool) {
    console.log(
      "  The LaunchpadPool layout could not be confirmed. Nothing that reads\n" +
        "  pool state should be trusted until it is — set HELIUS_RPC_URL and\n" +
        "  rerun, or fetch one known StonkFun pool by address.",
    );
  } else if (pool.length === LAUNCHPAD_POOL.SPAN) {
    console.log(
      "  Layout confirmed at the published span. test/launchlab-layout.test.ts\n" +
        "  should now pin this exact account as its fixture.",
    );
  }

  console.log(`\n  ${rpcCalls} RPC calls.\n`);
}

main().catch((error) => {
  console.error(`\nprobe failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
