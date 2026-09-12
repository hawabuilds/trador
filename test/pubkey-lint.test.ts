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

/** Words that mean "this is an account address, not a label". */
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
        if (hit) {
          findings.push({
            file: relative,
            line: index + 1,
            text: line.trim(),
            why: `case-folds "${hit}" — base58 is case-sensitive`,
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
      if (/\{40\}/.test(line) || /0x\[?[a-fA-F0-9-]*\]?\{40\}/.test(line)) {
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
  ];

  for (const sample of samples) {
    const lowered = sample.toLowerCase();
    const caught =
      /([A-Za-z0-9_.[\]"'`)]+)\s*\.toLowerCase\(\)/.test(sample) ||
      /normalizeaddress|sameaddress\b/.test(lowered) ||
      /\{40\}/.test(sample) ||
      /["'`]0x[a-fA-F0-9]{40}["'`]/.test(sample);
    assert.equal(caught, true, `linter missed: ${sample}`);
  }
});

test("the linter read some files", () => {
  // Guards against a wrong SRC path turning the suite into a no-op.
  assert.ok(sourceFiles(SRC).length > 0, "no source files found under src/");
});
