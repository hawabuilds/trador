/**
 * The guard that makes porting from an EVM codebase survivable.
 *
 * The app this one descends from folded every address to lowercase before
 * storing or comparing it, and it did so in 63 files — 206 bare
 * `.toLowerCase()` calls, plus 35 hardcoded 40-hex-character regexes. On Solana
 * every one of those is a bug, and almost all of them fail silently: the lookup
 * misses, or two different mints collide under one key.
 *
 * Reviewing for that by eye does not work, so it is a test. The rule:
 *
 *   - `.toLowerCase()` is fine on a symbol, ticker, handle, query or URL.
 *   - `.toLowerCase()` is never fine on a mint, address, pubkey, wallet,
 *     owner, creator, pool or account.
 *   - A 40-hex-character pattern has no meaning on Solana at all.
 *
 * If a line genuinely needs an exception, say so on it:
 *
 *   const key = ticker.toLowerCase(); // pubkey-lint-ok: ticker, not a mint
 */
import assert from "node:assert/strict";
import {readdirSync, readFileSync} from "node:fs";
import path from "node:path";
import {test} from "node:test";

const SRC = path.join(process.cwd(), "src");
const ALLOW = "pubkey-lint-ok";

/**
 * Words that mean "this is an account address, not a label".
 *
 * Matched as substrings, so `quoteMint` and `poolAddress` are both caught.
 */
const ADDRESS_WORDS = [
  "mint",
  "address",
  "pubkey",
  "publickey",
  "wallet",
  "owner",
  "creator",
  "account",
  "pool",
  "curve",
  "authority",
  "signer",
  "program",
  "platform",
  "vault",
  "feeaccount",
  "ata",
];

/**
 * Receivers that are addresses by what they hold rather than by their name.
 *
 * Matched as whole words, because substring matching on something this short
 * would flag every `valid`, `hidden` and `paid` in the codebase.
 *
 * `id` is here because it is the one that actually got through. An asset's id
 * in this app is a mint for a coin and a ticker for a stock, and `watchKey`
 * folded it — so starring a coin stored a lowercased mint that could never be
 * resolved back to an asset. The substring list missed it precisely because the
 * variable was not called anything address-shaped.
 */
const ADDRESS_IDENTIFIERS = ["id", "key", "maker", "holder", "recipient"];

interface Finding {
  file: string;
  line: number;
  text: string;
  why: string;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, {withFileTypes: true});
  } catch {
    return out; // src/ not populated yet
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scan(): Finding[] {
  const findings: Finding[] = [];

  for (const file of sourceFiles(SRC)) {
    const relative = path.relative(process.cwd(), file);
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    lines.forEach((line, index) => {
      if (line.includes(ALLOW)) return;

      const lowered = line.toLowerCase();

      // 1. Case folding something that is an address.
      for (const match of line.matchAll(/([A-Za-z0-9_.[\]"'`)]+)\s*\.toLowerCase\(\)/g)) {
        const receiver = match[1].toLowerCase();

        const hit = ADDRESS_WORDS.find((word) => receiver.includes(word));

        // Whole-word match on the final segment, so `asset.id` is caught but
        // `valid` and `hidden` are not.
        const segment = receiver.split(/[.[\]()"'`]+/).filter(Boolean).pop() ?? "";
        const named = ADDRESS_IDENTIFIERS.find((word) => segment === word);

        if (hit || named) {
          findings.push({
            file: relative,
            line: index + 1,
            text: line.trim(),
            why: `case-folds "${hit ?? named}" — base58 is case-sensitive`,
          });
        }
      }

      // 2. `toLowerCase` reached for on a whole row/record that carries
      //    addresses, which is how a bulk normaliser usually sneaks in.
      if (/normalizeaddress|normalizeaddresses|sameaddress\b/.test(lowered)) {
        findings.push({
          file: relative,
          line: index + 1,
          text: line.trim(),
          why: "EVM address helper — use asPubkey/assertPubkey/samePubkey",
        });
      }

      // 3. A 40-hex-character pattern is an EVM address by construction.
      //
      //    Anchored on `]{40}` — the close of a character class — because that
      //    is how every such regex is written (`[a-fA-F0-9]{40}`). Matching a
      //    bare `{40}` also flags `size={40}` in JSX, and a linter that cries
      //    wolf on ordinary markup is a linter somebody switches off.
      if (/\]\{40\}/.test(line)) {
        findings.push({
          file: relative,
          line: index + 1,
          text: line.trim(),
          why: "40-hex-character address pattern has no meaning on Solana",
        });
      }

      // 4. A literal EVM address left behind in a port.
      if (/["'`]0x[a-fA-F0-9]{40}["'`]/.test(line)) {
        findings.push({
          file: relative,
          line: index + 1,
          text: line.trim(),
          why: "hardcoded EVM address",
        });
      }
    });
  }

  return findings;
}

test("no source file folds the case of an account address", () => {
  const findings = scan();

  const report = findings
    .map((f) => `  ${f.file}:${f.line}\n    ${f.why}\n    ${f.text}`)
    .join("\n\n");

  assert.equal(
    findings.length,
    0,
    findings.length === 0
      ? ""
      : `${findings.length} address-handling problem(s):\n\n${report}\n\n` +
          `Use asPubkey/assertPubkey/samePubkey from @/lib/pubkey. If a line is ` +
          `genuinely about a symbol or handle rather than an address, mark it ` +
          `with "// ${ALLOW}: <reason>".`,
  );
});

test("the linter actually catches what it claims to", () => {
  // A self-check, because a scanner that silently matches nothing is worse than
  // no scanner: it reports success over a codebase it never read.
  const samples = [
    'const key = mintAddress.toLowerCase();',
    'const a = normalizeAddress(value);',
    'const RE = /^0x[a-f0-9]{40}$/;',
    'const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";',
    /*
     * The two that actually got through a weaker version of this rule, both
     * found only after the substring list was extended with whole-word
     * identifiers. Neither variable is named anything address-shaped:
     *
     *   - `watchKey` folded an asset id, which is a mint. Starring a coin
     *     stored a key that could never resolve back to an asset, so the
     *     Watchlist tab would have stayed empty forever.
     *   - the shared price store keyed readings by a folded id, which would
     *     serve one mint's price under another's key.
     */
    "return `${kind}:${id.toLowerCase()}`;",
    "const keyFor = (id: string) => id.toLowerCase();",
    "const k = asset.id.toLowerCase();",
  ];

  /**
   * Mirrors `scan`'s rules.
   *
   * Written out rather than sharing the scanner's code on purpose: if someone
   * loosens the real rule, this self-check keeps the old expectation and fails,
   * which is the point of having it.
   */
  const catches = (sample: string): boolean => {
    const lowered = sample.toLowerCase();

    for (const match of sample.matchAll(/([A-Za-z0-9_.[\]"'`)]+)\s*\.toLowerCase\(\)/g)) {
      const receiver = match[1].toLowerCase();
      if (ADDRESS_WORDS.some((word) => receiver.includes(word))) return true;
      const segment = receiver.split(/[.[\]()"'`]+/).filter(Boolean).pop() ?? "";
      if (ADDRESS_IDENTIFIERS.includes(segment)) return true;
    }

    return (
      /normalizeaddress|sameaddress\b/.test(lowered) ||
      /\]\{40\}/.test(sample) ||
      /["'`]0x[a-fA-F0-9]{40}["'`]/.test(sample)
    );
  };

  for (const sample of samples) {
    assert.equal(catches(sample), true, `linter missed: ${sample}`);
  }

  /**
   * And the false positives it must not produce.
   *
   * `size={40}` is the one that actually fired — ordinary JSX that looked like
   * a hex-length quantifier. A rule that flags markup gets disabled, and a
   * disabled rule protects nothing, so the negative cases are pinned too.
   */
  const mustNotCatch = [
    "<Avatar name={symbol} seed={asset.mint} size={40} />",
    "const width = {40: true};",
    'const key = ticker.toUpperCase();',
    "padding: {40}",
    // Handles are labels, so folding them is correct.
    "return readFollowing().includes(handle.toLowerCase());",
    // Short words that merely contain an identifier's letters.
    "const ok = valid.toLowerCase();",
    "const s = hidden.toLowerCase();",
  ];

  for (const sample of mustNotCatch) {
    assert.equal(catches(sample), false, `linter false-positived on: ${sample}`);
  }
});

test("the linter read some files", () => {
  // Guards against a wrong SRC path turning the suite into a no-op.
  assert.ok(sourceFiles(SRC).length > 0, "no source files found under src/");
});
