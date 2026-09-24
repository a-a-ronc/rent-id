import { Link } from "@tanstack/react-router";
import { Plus, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { AppShell } from "@/components/rentid/AppShell";
import { Glass, Eyebrow, MetricCard } from "@/components/rentid/Surface";
import { cn } from "@/lib/utils";

export { AppShell };

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string | undefined;
  action?: ReactNode | undefined;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[24px] leading-tight font-bold tracking-tight">{title}</h1>
        {subtitle ? <Eyebrow className="mt-1">{subtitle}</Eyebrow> : null}
      </div>
      {action}
    </div>
  );
}

export function ToolbarButton({
  to,
  label,
  onClick,
  icon: Icon = Plus,
}: {
  to?: string;
  label: string;
  onClick?: () => void;
  icon?: LucideIcon;
}) {
  const cls =
    "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-brand-foreground transition-opacity hover:opacity-90";
  if (to) {
    return (
      <Link to={to} className={cls}>
        <Icon className="size-3.5" strokeWidth={2} />
        {label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      <Icon className="size-3.5" strokeWidth={2} />
      {label}
    </button>
  );
}

export function SectionCard({
  title,
  aside,
  footer,
  className,
  children,
}: {
  title: string;
  aside?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Glass className={cn("overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <h2 className="font-display text-[15px] font-semibold tracking-tight">{title}</h2>
        {aside ? <Eyebrow>{aside}</Eyebrow> : null}
      </div>
      <div className="divide-y divide-border/50">{children}</div>
      {footer ? <div className="border-t border-border/60 px-4 py-3">{footer}</div> : null}
    </Glass>
  );
}

export function ListRow({
  title,
  subtitle,
  value,
  pill,
  onClick,
  delay,
}: {
  title: string;
  subtitle?: string | undefined;
  value?: ReactNode | undefined;
  pill?: ReactNode | undefined;
  onClick?: (() => void) | undefined;
  delay?: number | undefined;
}) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">{title}</p>
        {subtitle ? (
          <p className="num mt-0.5 truncate text-[11.5px] text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {(pill != null || value != null) && (
        <div className="flex shrink-0 items-center gap-3">
          {pill}
          {value != null && (typeof value === "string" || typeof value === "number") ? (
            <span className="num text-[14px] font-medium">{value}</span>
          ) : (
            value
          )}
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60"
        style={delay ? { animationDelay: `${delay}ms` } : undefined}
      >
        {content}
      </button>
    );
  }
  return <div className="flex items-center gap-3 px-4 py-3">{content}</div>;
}

export function StatusPill({
  status,
  tone = "neutral",
}: {
  status: string;
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
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 font-display text-[10.5px] font-medium capitalize whitespace-nowrap",
        tones[tone],
      )}
    >
      {status}
    </span>
  );
}

export function SummaryGrid({
  items,
  className,
}: {
  items: {
    label: string;
    value: ReactNode;
    hint?: string;
    tone?: "neutral" | "success" | "warning" | "danger";
  }[];
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}>
      {items.map((item, i) => (
        <MetricCard key={item.label} {...item} delay={i * 60} />
      ))}
    </div>
  );
}

export * from "@/components/rentid/kit";
export { TrustBadge, VerificationChecklist } from "@/components/rentid/TrustBadge";
export {
  Glass,
  Eyebrow,
  MetricCard,
  Pill,
  EmptyState,
  SectionHeading,
  ComingSoon,
} from "@/components/rentid/Surface";
