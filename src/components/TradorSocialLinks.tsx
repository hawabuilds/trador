import type {SVGProps} from "react";

import {TRADOR_SOCIAL} from "@/config/app";
import {cn} from "@/lib/cn";
import {DiscordIcon, XIcon} from "./ui/Icons";

const LINKS: {
  href: string;
  label: string;
  Icon: (props: SVGProps<SVGSVGElement>) => JSX.Element;
}[] = [
  {href: TRADOR_SOCIAL.x, label: "Trador on X", Icon: XIcon},
  {href: TRADOR_SOCIAL.discord, label: "Trador on Discord", Icon: DiscordIcon},
];

/** X and Discord for the Trador product — not a user's profile links. */
export function TradorSocialLinks({
  className,
  size = 18,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <div className={cn("flex items-center gap-1", className)} role="group" aria-label="Trador community">
      {LINKS.map(({href, label, Icon}) => (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          title={label}
          className="grid h-9 w-9 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
        >
          <Icon style={{width: size, height: size}} />
        </a>
      ))}
    </div>
  );
}
