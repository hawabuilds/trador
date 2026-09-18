/**
 * The Trador mark, inline.
 *
 * Inline rather than an `<img>` pointing at the SVG file, for two reasons: it
 * paints in the same frame as the text beside it instead of popping in after a
 * request, and its colour comes from `currentColor`, so it follows whatever
 * text colour its container sets — the brand purple by default, but white on a
 * purple button without a second asset.
 *
 * The paths are the same ones as `public/brand/trador-mark.svg`, which every
 * raster icon is generated from (`npm run brand:icons`). If the mark changes,
 * change both.
 */
export function TradorMark({
  size = 24,
  className,
  title,
}: {
  /** Width in pixels. The height follows the mark's own proportions. */
  size?: number;
  className?: string;
  /** Pass a title when the mark stands alone; omit it beside the name. */
  title?: string;
}) {
  return (
    <svg
      viewBox="225 342 805 570"
      width={size}
      height={Math.round((size * 570) / 805)}
      fill="currentColor"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d="M252 342 L1003 342 Q1030 342 1020 366 L941 530 Q932 548 912 548 L713 548 Q704 548 700 536 L675 492.5 A55 55 0 0 0 580 492.5 L555 536 Q551 548 542 548 L343 548 Q323 548 314 530 L235 366 Q225 342 252 342 Z" />
      <path d="M636 593 L710 593 Q718 593 718 601 L718 785 Q718 800 705 808 L548 906 Q538 912 538 900 L538 696 Q538 680 549 669 L612 603 Q622 593 636 593 Z" />
    </svg>
  );
}
