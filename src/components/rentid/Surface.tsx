import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Glass({
  children,
  className,
  delay,
}: {
  children: ReactNode;
  className?: string | undefined;
  delay?: number | undefined;
}) {
  return (
    <div
      className={cn("glass animate-settle rounded-2xl", className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("label-eyebrow", className)}>{children}</p>;
}

export function SectionHeading({
  title,
  aside,
  className,
}: {
  title: string;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-2.5 flex items-center justify-between gap-3", className)}>
      <h2 className="font-display text-[15px] font-semibold tracking-tight">{title}</h2>
      {aside ? <div className="label-eyebrow">{aside}</div> : null}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
  delay,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  delay?: number;
}) {
  const dot =
    tone === "success"
      ? "bg-success"
      : tone === "warning"
        ? "bg-warning"
        : tone === "danger"
          ? "bg-destructive"
          : "bg-border";
  const hintTone =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <Glass className="p-4" delay={delay}>
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>{label}</Eyebrow>
        <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
      </div>
      <p className="num mt-2 text-[26px] leading-none font-medium">{value}</p>
      {hint ? <p className={cn("mt-2 text-[11px]", hintTone)}>{hint}</p> : null}
    </Glass>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-muted text-muted-foreground",
    success: "bg-success/10 text-success",
    warning: "bg-warning/12 text-warning",
    danger: "bg-destructive/10 text-destructive",
    accent: "bg-accent/12 text-accent",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Glass className="p-8 text-center">
      <h3 className="font-display text-[15px] font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-[13px] text-muted-foreground">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </Glass>
  );
}

export function ComingSoon({
  title,
  description,
  points,
}: {
  title: string;
  description: string;
  points: string[];
}) {
  return (
    <Glass className="p-6">
      <Eyebrow>Planned</Eyebrow>
      <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
        {description}
      </p>
      <ul className="mt-4 space-y-2">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2.5 text-[13px]">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
            <span className="text-muted-foreground">{point}</span>
          </li>
        ))}
      </ul>
    </Glass>
  );
}
