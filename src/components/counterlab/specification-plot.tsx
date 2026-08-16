import type { CSSProperties } from "react";
import { formatResearchEffect } from "@/lib/counterlab/research";
import type { EffectScale, SpecificationResult } from "@/lib/counterlab/types";

const STATUS_COLOR: Record<string, string> = {
  supports: "bg-supports",
  challenges: "bg-challenges",
  uncertain: "bg-uncertain",
};

export function SpecificationPlot({
  specifications,
  scale,
  label,
}: {
  specifications: SpecificationResult[];
  scale: EffectScale;
  label: string;
}) {
  const allValues = specifications.flatMap((item) => [item.ciLow, item.ciHigh, item.estimate]);
  const spread = Math.max(...allValues) - Math.min(...allValues);
  const padding = Math.max(spread * 0.12, scale === "proportion" ? 0.025 : 0.01);
  const domainMin = Math.min(0, ...allValues) - padding;
  const domainMax = Math.max(0, ...allValues) + padding;
  const position = (value: number) =>
    ((value - domainMin) / Math.max(1e-12, domainMax - domainMin)) * 100;
  const zero = position(0);

  return (
    <div
      className="space-y-3"
      role="img"
      aria-label={`${label} specification curve with 95 percent intervals`}
    >
      <div className="label-micro flex items-center justify-between">
        <span>Negative</span>
        <span className="normal-case tracking-normal">{label} · 95% CI</span>
        <span>Positive</span>
      </div>

      <div className="space-y-1.5">
        {specifications.map((item) => {
          const left = position(item.ciLow);
          const right = position(item.ciHigh);
          const point = position(item.estimate);
          return (
            <div
              key={item.id}
              className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-md px-1.5 py-1.5 transition-colors hover:bg-surface"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">{item.shortLabel}</p>
                <p className="label-micro text-[0.6rem]">{item.family}</p>
              </div>
              <div
                className="relative h-6 rounded-sm bg-surface"
                style={{ "--zero": `${zero}%` } as CSSProperties}
              >
                <span className="absolute inset-y-0 w-px bg-border" style={{ left: `${zero}%` }} />
                <span
                  className={`absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full opacity-45 ${STATUS_COLOR[item.status]}`}
                  style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }}
                />
                <span
                  className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card ${STATUS_COLOR[item.status]}`}
                  style={{ left: `${point}%` }}
                />
              </div>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatResearchEffect(item.estimate, scale)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <i className="size-2 rounded-full bg-supports" /> Supports
        </span>
        <span className="flex items-center gap-1.5">
          <i className="size-2 rounded-full bg-challenges" /> Challenges
        </span>
        <span className="flex items-center gap-1.5">
          <i className="size-2 rounded-full bg-uncertain" /> Uncertain
        </span>
      </div>
    </div>
  );
}