import bs58 from "bs58";
import {stockForMint} from "./src/lib/stocks/registry.ts";
const rpc = async (m, p) => (await (await fetch(process.env.HELIUS_RPC_URL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method: m, params: p})})).json()).result;
const POOL = "Bkkau4CqFzUjyqLb5mfTXkpwBCknbMQYLBbwuQWNNJHU";
const a = await rpc("getAccountInfo", [POOL, {encoding: "base64"}]);
const b = Buffer.from(a.value.data[0], "base64");
console.log("pool owner(program):", a.value.owner, "len", b.length);
console.log("creator@41:", bs58.encode(b.subarray(41, 73)));
console.log("mint0:", bs58.encode(b.subarray(73, 105)), "mint1:", bs58.encode(b.subarray(105, 137)));
// what is LIT?
for (const m of ["EicWvtCJbG4X5jMwwCJPGbsCFX4BwHMmuHKHcdCtypsW", bs58.encode(b.subarray(73, 105)), bs58.encode(b.subarray(105, 137))]) {
  const info = await rpc("getAccountInfo", [m, {encoding: "jsonParsed"}]);
  if (!info?.value) { console.log(m, "no account"); continue; }
  const i = info.value.data.parsed.info;
  console.log(m, "program", info.value.owner.slice(0, 8), "dec", i.decimals, "mintAuth", i.mintAuthority, "registered:", stockForMint(m)?.ticker ?? "NO");
}
