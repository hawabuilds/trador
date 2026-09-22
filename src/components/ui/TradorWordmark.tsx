/**
 * The TRADOR wordmark: Montserrat Bold, capitals, wide tracking, with the
 * A drawn as an open chevron (no crossbar). The chevron is inline SVG sized in
 * `em`, so it scales with the font size and takes the text colour.
 */
export function TradorWordmark({className}: {className?: string}) {
  return (
    <span
      className={`inline-flex items-baseline font-wordmark font-bold uppercase leading-none tracking-[0.2em] ${className ?? ""}`}
      aria-label="Trador"
      role="img"
    >
      <span aria-hidden>TR</span>
      <svg
        aria-hidden
        viewBox="0 0 70 70"
        fill="currentColor"
        style={{width: "0.72em", height: "0.7em", marginRight: "0.2em"}}
      >
        <path d="M0 70 L35 0 L70 70 L55 70 L35 29 L15 70 Z" />
      </svg>
      <span aria-hidden className="-mr-[0.2em]">DOR</span>
    </span>
  );
}
