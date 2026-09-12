/**
 * Sectors for the tokenized-stock universe.
 *
 * Neither xStocks nor PreStocks publishes a sector field, so the mapping lives
 * here, keyed by ticker. The buckets are deliberately not GICS: this universe
 * is overwhelmingly technology, and one "Technology" chip holding most of the
 * list would be useless to filter by. They follow what people actually trade
 * against instead — AI and semis apart from software, crypto-linked equities
 * apart from both, and pre-IPO as its own bucket because those names have no
 * public market at all.
 *
 * A ticker the registry adds before this map catches up simply has no sector.
 * It stays searchable and stays on the All chip, which is why there is no
 * catch-all bucket.
 */

export type SectorId =
  | "ai"
  | "semis"
  | "software"
  | "internet"
  | "space"
  | "crypto"
  | "consumer"
  | "finance"
  | "funds"
  | "commodities"
  | "preipo";

export interface Sector {
  id: SectorId;
  label: string;
}

export const SECTORS: readonly Sector[] = [
  {id: "ai", label: "AI"},
  {id: "semis", label: "Semis"},
  {id: "software", label: "Software"},
  {id: "internet", label: "Internet"},
  {id: "space", label: "Space"},
  {id: "crypto", label: "Crypto"},
  {id: "consumer", label: "Consumer"},
  {id: "finance", label: "Finance"},
  {id: "funds", label: "Funds"},
  {id: "commodities", label: "Commodities"},
  {id: "preipo", label: "Pre-IPO"},
];

export const SECTOR_LABEL: ReadonlyMap<SectorId, string> = new Map(
  SECTORS.map((sector) => [sector.id, sector.label]),
);

/**
 * Ticker → sector, for the stocks currently in the registry.
 *
 * Keyed by the xStocks/PreStocks ticker exactly as the issuer spells it.
 */
const BY_TICKER: Record<string, SectorId> = {
  // Semis and AI hardware
  NVDAx: "semis",
  INTCx: "semis",

  // Software and platforms
  MSFTx: "software",
  PLTRx: "ai",
  GOOGLx: "internet",
  METAx: "internet",
  AMZNx: "internet",
  AAPLx: "consumer",

  // Space and defence
  SPCXx: "space",

  // Crypto-linked equities
  COINx: "crypto",
  MSTRx: "crypto",
  HOODx: "crypto",
  CRCLx: "crypto",
  DFDVx: "crypto",
  STRCx: "crypto",

  // Consumer
  MCDx: "consumer",
  KOx: "consumer",
  GMEx: "consumer",

  // Finance and funds
  "BRK.Bx": "finance",
  SPYx: "funds",
  QQQx: "funds",

  // Commodities
  GLDx: "commodities",

  // Pre-IPO
  OPENAI: "preipo",
  ANTHROPIC: "preipo",
  POLYMARKET: "preipo",
  NEURALINK: "preipo",
  KALSHI: "preipo",
  ANDURIL: "preipo",
};

export function sectorFor(ticker: string): SectorId | null {
  return BY_TICKER[ticker] ?? null;
}
