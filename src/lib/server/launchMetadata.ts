/**
 * Hosting a new coin's name, symbol and picture.
 *
 * A launch writes a `uri` into the coin's Token-2022 metadata, and every wallet,
 * explorer and launchpad fetches that URL to find the coin's image and links. So
 * it has to be public, permanent and plain: a Metaplex-shaped JSON file with the
 * image beside it, in a public Supabase Storage bucket.
 *
 * The bucket is created on first use. It holds nothing private — everything in
 * it is published on-chain by the launch anyway — so public read is the point.
 */

import {randomUUID} from "node:crypto";

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BUCKET = "launch-metadata";

export const metadataReady = Boolean(URL_BASE && KEY);

/** Two megabytes: more than any coin icon needs, and a cap on abuse. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const headers = () => ({apikey: KEY, authorization: `Bearer ${KEY}`});

let bucketReady: Promise<void> | null = null;

/** Create the public bucket once per process; an existing one is fine. */
function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const response = await fetch(`${URL_BASE}/storage/v1/bucket`, {
      method: "POST",
      headers: {...headers(), "content-type": "application/json"},
      body: JSON.stringify({id: BUCKET, name: BUCKET, public: true}),
    });
    // 409 / "already exists" is success for our purposes.
    if (!response.ok && response.status !== 409) {
      const text = await response.text();
      if (!/exist/i.test(text)) {
        bucketReady = null;
        throw new Error(`Could not prepare metadata storage (${response.status}).`);
      }
    }
  })();
  return bucketReady;
}

async function put(path: string, body: Buffer | string, contentType: string): Promise<string> {
  const response = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {...headers(), "content-type": contentType, "x-upsert": "false"},
    // A Blob, which every fetch body accepts regardless of how the runtime
    // types its typed arrays.
    body: new Blob([typeof body === "string" ? body : new Uint8Array(body)], {type: contentType}),
  });
  if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
  return `${URL_BASE}/storage/v1/object/public/${BUCKET}/${path}`;
}

export class MetadataRejected extends Error {}

/**
 * An address exactly as long as a real one will be, for pricing a launch
 * before anything is uploaded. The coin's on-chain metadata is sized to its
 * `uri`, so a shorter stand-in would under-quote the rent.
 */
export function placeholderMetadataUri(): string {
  return `${URL_BASE || "https://example.supabase.co"}/storage/v1/object/public/${BUCKET}/${"0".repeat(36)}.json`;
}

/**
 * Store a coin's image and metadata; return the URI the launch will point at.
 *
 * The image arrives as a data URL and is checked by its declared type and its
 * decoded size — never trusted by extension. Links must be plain https, the same
 * rule every creator-supplied link in this app gets, because they end up in an
 * `href` on screens other people see.
 */
export async function uploadLaunchMetadata(input: {
  name: string;
  symbol: string;
  description: string;
  imageDataUrl: string;
  links: {twitter?: string; telegram?: string; website?: string};
}): Promise<{uri: string; image: string}> {
  if (!metadataReady) throw new MetadataRejected("Metadata storage is not configured.");

  const match = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(input.imageDataUrl);
  if (!match) throw new MetadataRejected("Pick an image for your coin.");
  const extension = IMAGE_TYPES[match[1]];
  if (!extension) throw new MetadataRejected("Use a PNG, JPEG, WebP or GIF image.");

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new MetadataRejected("That image is over 2 MB. Pick a smaller one.");
  }

  await ensureBucket();

  const id = randomUUID();
  const image = await put(`${id}.${extension}`, bytes, match[1]);

  const https = (value: string | undefined) => {
    if (!value) return undefined;
    try {
      const url = new URL(value.trim());
      return url.protocol === "https:" ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  };

  const extensions = Object.fromEntries(
    Object.entries({
      twitter: https(input.links.twitter),
      telegram: https(input.links.telegram),
      website: https(input.links.website),
    }).filter(([, value]) => value !== undefined),
  );

  const metadata = {
    name: input.name,
    symbol: input.symbol,
    description: input.description,
    image,
    ...(Object.keys(extensions).length > 0 ? {extensions} : {}),
    // Also at the top level, which is where some launchpads read links from.
    ...extensions,
    createdOn: "https://trador-tau.vercel.app",
  };

  const uri = await put(`${id}.json`, JSON.stringify(metadata), "application/json");
  return {uri, image};
}
