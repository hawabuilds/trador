/**
 * Reading facts out of somebody else's HTML.
 *
 * Pure, and kept apart from the fetching so the rules can be tested against
 * real pages' markup without a network. Regexes rather than a parser on
 * purpose: only a handful of `<head>` tags are wanted, the input is capped at a
 * couple of hundred kilobytes, and a DOM library for this would be a
 * dependency and a parse of an entire news page to read four attributes.
 */

export function meta(html: string, name: string): string | null {
  const escaped = name.replace(/:/g, "\\:");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const found = html.match(pattern)?.[1];
    if (found) return decodeEntities(found.trim());
  }
  return null;
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** The embed's blockquote, as the words in it. */
export function textFromHtml(html: string): string {
  const quote = html.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i)?.[1] ?? html;
  // The embed ends with "— Name (@handle) date", which the card has already.
  const text = quote
    .replace(/<a[^>]*>[\s\S]*?<\/a>\s*$/i, "")
    .replace(/&mdash;[\s\S]*$/i, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text).trim();
}

/** Drops the t.co link X appends for the post's own media. */
export function cleanTweet(text: string): string {
  return text.replace(/\s*https:\/\/t\.co\/\w+\s*$/, "").trim();
}
