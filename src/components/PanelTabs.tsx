"use client";

import {cn} from "@/lib/cn";

export interface PanelTab<T extends string> {
  value: T;
  label: string;
}

/**
 * The underlined tab row beneath a chart. Selection is carried by the rule and
 * the weight change, not by colour alone.
 */
export function PanelTabs<T extends string>({
  tabs,
  value,
  onChange,
  size = "sm",
  align = "fill",
  label = "Asset detail",
}: {
  tabs: PanelTab<T>[];
  value: T;
  onChange: (value: T) => void;
  /** `sm` sits under a chart, `md` under a page title. */
  size?: "sm" | "md";
  /** `fill` splits the width evenly; `start` keeps the labels together. */
  align?: "fill" | "start";
  label?: string;
}) {
  const md = size === "md";

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex", align === "start" && "gap-6")}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              "relative pb-2.5 pt-1 transition-colors duration-150",
              align === "fill" ? "flex-1" : "flex-none",
              md ? "text-[15px]" : "text-[13px]",
              active
                ? cn("text-ink", md ? "font-semibold" : "font-extrabold")
                : cn("text-faint hover:text-muted", md ? "font-normal" : "font-bold"),
            )}
          >
            {tab.label}
            <span
              aria-hidden="true"
              className={cn(
                "absolute -bottom-px h-[2px] rounded-full transition-opacity duration-150",
                align === "fill" ? "inset-x-3" : "inset-x-0",
                active ? "bg-brand-500 opacity-100" : "opacity-0",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
