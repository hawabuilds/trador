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
 * **Twelve sectors**, fixed: same ids, same labels, same descriptions, same
 * rail order. Inventing a parallel set for the same kind of universe had
 * already started to drift — disagreeing about what "Internet & Media"
 * contains is a difference nobody benefits from.
 *
 * One consequence worth stating: there is **no pre-IPO bucket**. The pre-IPO
 * names are classified by what the company does, so OpenAI sits under AI & Data
 * with the rest of the AI names rather than in a bucket about its funding
 * stage. That a name is not publicly listed is said on its own page, where
 * there is room to explain what it means for the price.
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
 * ticker is already classified elsewhere in this map, it stays in that bucket.
 *
 * Every entry here is covered by a test — a stock added without a sector fails
 * it, rather than quietly rendering the issuer's product string in the slot
 * where the category goes.
 */
const BY_TICKER: Record<string, SectorId> = {
  // Semiconductors
  NVDAx: "semis",
  NVDA: "semis",
  INTCx: "semis",
  INTC: "semis",
  ARM: "semis",
  MU: "semis",
  SKHY: "semis",
  SNDK: "semis",
  MRVL: "semis",
  AMD: "semis",

  // AI & Data — including the pre-IPO AI labs, classified by what they build.
  PLTRx: "ai",
  NBIS: "ai",
  CRWV: "ai",
  DELL: "ai",
  OPENAI: "ai",
  ANTHROPIC: "ai",
  XAI: "ai",
  FIGUREAI: "ai",
  tOpenAI: "ai",

  // Software
  MSFTx: "software",
  IBM: "software",
  BB: "software",
  // An AI-agent operating system sold to enterprises: software, not compute.
  VIDAx: "software",

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
  RUM: "internet",
  CYPH: "internet",

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
  WULF: "crypto",
  IREN: "crypto",
  // Forward Industries runs a Solana treasury; that is what its price tracks.
  FWDI: "crypto",

  // Quantum
  QUBT: "quantum",
  IONQ: "quantum",

  // Healthcare
  LLY: "health",
  JNJ: "health",
  PFE: "health",
  MRNA: "health",
  HIMS: "health",
  PTN: "health",
  NEURALINK: "health",

  // Consumer — retail, autos and leisure together.
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
  BROS: "consumer",
  LUV: "consumer",
  FTSU: "consumer",

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
  COPX: "funds",
  URA: "funds",
  USO: "funds",
};

export function sectorFor(ticker: string): SectorId | null {
  return BY_TICKER[ticker] ?? null;
}
