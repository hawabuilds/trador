/**
 * Sectors for the tokenized-stock universe.
 *
 * Neither xStocks, PreStocks, Backpack nor Tessera publishes a sector field, so
 * the mapping lives here, keyed by ticker. The buckets are deliberately not
 * GICS: this universe is overwhelmingly technology, and one "Technology" chip
 * holding most of the list would be useless to filter by. They follow what
 * people actually trade against instead — AI and semis apart from software,
 * crypto-linked equities apart from both.
 *
 * **These are HODL's twelve, exactly**: same ids, same labels, same
 * descriptions, same rail order. Two apps over the same kind of universe
 * disagreeing about what "Internet & Media" contains is a difference nobody
 * benefits from, and the alternative was a set invented here that had already
 * started to drift.
 *
 * One consequence worth stating: there is **no pre-IPO bucket**, because HODL
 * has none. The pre-IPO names are classified by what the company does, so
 * OpenAI sits under AI & Data with the rest of the AI names rather than in a
 * bucket about its funding stage. That a name is not publicly listed is said on
 * its own page, where there is room to explain what it means for the price.
 */

export type SectorId =
  | "semis"
  | "ai"
  | "software"
  | "internet"
  | "space"
  | "energy"
  | "crypto"
  | "quantum"
  | "health"
  | "consumer"
  | "finance"
  | "funds";

export interface Sector {
  id: SectorId;
  label: string;
  /** Longer form, for the detail page's tag and screen readers. */
  description: string;
}

/** Rail order. Curated rather than sorted by size, so chip positions stay learnable. */
export const SECTORS: readonly Sector[] = [
  {id: "semis", label: "Semiconductors", description: "Chips, equipment & photonics"},
  {id: "ai", label: "AI & Data", description: "AI compute, cloud & data centers"},
  {id: "software", label: "Software", description: "Enterprise & consumer software"},
  {id: "internet", label: "Internet & Media", description: "Platforms, social & entertainment"},
  {id: "space", label: "Space & Defense", description: "Aerospace, defense & satellites"},
  {id: "energy", label: "Energy", description: "Power, nuclear & materials"},
  {id: "crypto", label: "Crypto", description: "Digital assets & mining"},
  {id: "quantum", label: "Quantum", description: "Quantum computing"},
  {id: "health", label: "Healthcare", description: "Pharma, biotech & care"},
  {id: "consumer", label: "Consumer", description: "Retail, autos & leisure"},
  {id: "finance", label: "Finance", description: "Banks, brokers & fintech"},
  {id: "funds", label: "Funds & ETFs", description: "Index, bond & commodity funds"},
];

export const SECTOR_LABEL: ReadonlyMap<SectorId, string> = new Map(
  SECTORS.map((sector) => [sector.id, sector.label]),
);

export const SECTOR_DESCRIPTION: ReadonlyMap<SectorId, string> = new Map(
  SECTORS.map((sector) => [sector.id, sector.description]),
);

/**
 * Ticker → sector, for every stock in the registry.
 *
 * Keyed by the ticker exactly as its issuer spells it, which is why the same
 * company can appear twice: Backed's wrapper is `INTCx` and Backpack's is
 * `INTC`, and they are different mints with different transfer fees. Where a
 * ticker matches one HODL already classifies, it is placed in the same bucket.
 *
 * Every entry here is covered by a test — a stock added without a sector fails
 * it, rather than quietly rendering the issuer's product string in the slot
 * where the category goes.
 */
const BY_TICKER: Record<string, SectorId> = {
  // Semiconductors
  NVDAx: "semis",
  INTCx: "semis",
  INTC: "semis",
  MU: "semis",
  SKHY: "semis",
  SNDK: "semis",
  MRVL: "semis",

  // AI & Data — including the pre-IPO AI labs, classified by what they build.
  PLTRx: "ai",
  NBIS: "ai",
  DELL: "ai",
  OPENAI: "ai",
  ANTHROPIC: "ai",
  XAI: "ai",
  FIGUREAI: "ai",
  tOpenAI: "ai",

  // Software
  MSFTx: "software",
  IBM: "software",

  // Internet & Media
  GOOGLx: "internet",
  METAx: "internet",
  AMZNx: "internet",
  BABA: "internet",
  DJT: "internet",
  RBLX: "internet",
  RDDT: "internet",
  SHOP: "internet",
  SNAP: "internet",
  TTWO: "internet",
  GRND: "internet",
  SPHR: "internet",

  // Space & Defense
  SPCXx: "space",
  SPCX: "space",
  SPACEX: "space",
  tSpaceX: "space",
  ANDURIL: "space",
  FLY: "space",
  BA: "space",
  LMT: "space",

  // Crypto
  COINx: "crypto",
  MSTRx: "crypto",
  MSTR: "crypto",
  HOODx: "crypto",
  HOOD: "crypto",
  CRCLx: "crypto",
  DFDVx: "crypto",
  STRCx: "crypto",
  BULL: "crypto",

  // Quantum
  QUBT: "quantum",

  // Healthcare
  LLY: "health",
  JNJ: "health",
  PFE: "health",
  MRNA: "health",
  HIMS: "health",
  PTN: "health",
  NEURALINK: "health",

  // Consumer — retail, autos and leisure, which is where HODL puts all three.
  AAPLx: "consumer",
  MCDx: "consumer",
  KOx: "consumer",
  GMEx: "consumer",
  TSLAx: "consumer",
  RIVN: "consumer",
  NKE: "consumer",
  LULU: "consumer",
  COST: "consumer",
  WEN: "consumer",
  DNUT: "consumer",
  FLWS: "consumer",
  GPRO: "consumer",
  HTZ: "consumer",
  DKNG: "consumer",
  AMC: "consumer",
  MGM: "consumer",
  UPS: "consumer",

  // Finance — prediction markets included, since that is what they settle.
  "BRK.Bx": "finance",
  KALSHI: "finance",
  tKalshi: "finance",
  POLYMARKET: "finance",

  // Funds & ETFs
  SPYx: "funds",
  QQQx: "funds",
  GLDx: "funds",
  SCHH: "funds",
  DRAM: "funds",
  BOT: "funds",
};

export function sectorFor(ticker: string): SectorId | null {
  return BY_TICKER[ticker] ?? null;
}
