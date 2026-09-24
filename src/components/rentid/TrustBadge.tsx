/**
 * Trust & verification visual language.
 *
 * A tenancy shows "Verified Tenancy" only when landlord, tenant account,
 * property, unit and lease are all associated. The other labels are styling
 * groundwork for future trust signals — no reputation scoring exists yet.
 */
import { AlertTriangle, BadgeCheck, ShieldCheck, UserCheck, Home, Scale } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type TrustLabel =
  | "verified_tenancy"
  | "verified_payment"
  | "platform_verified"
  | "landlord_reported"
  | "tenant_reported"
  | "under_dispute"
  | "unverified";

const TRUST: Record<TrustLabel, { label: string; icon: LucideIcon; className: string }> = {
  verified_tenancy: {
    label: "Verified Tenancy",
    icon: BadgeCheck,
    className: "bg-success/10 text-success ring-1 ring-success/20",
  },
  verified_payment: {
    label: "Verified Payment",
    icon: ShieldCheck,
    className: "bg-success/10 text-success ring-1 ring-success/20",
  },
  platform_verified: {
    label: "Platform Verified",
    icon: ShieldCheck,
    className: "bg-brand/10 text-brand ring-1 ring-brand/20",
  },
  landlord_reported: {
    label: "Landlord Reported",
    icon: Home,
    className: "bg-accent/12 text-accent ring-1 ring-accent/20",
  },
  tenant_reported: {
    label: "Tenant Reported",
    icon: UserCheck,
    className: "bg-accent/12 text-accent ring-1 ring-accent/20",
  },
  under_dispute: {
    label: "Under Dispute",
    icon: Scale,
    className: "bg-warning/12 text-warning ring-1 ring-warning/20",
  },
  unverified: {
    label: "Unverified",
    icon: AlertTriangle,
    className: "bg-muted text-muted-foreground ring-1 ring-border",
  },
};

export function TrustBadge({
  kind,
  label,
  size = "sm",
  className,
}: {
  kind: TrustLabel;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const config = TRUST[kind];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-display font-medium whitespace-nowrap",
        size === "md" ? "px-3 py-1.5 text-[12px]" : "px-2.5 py-1 text-[10.5px]",
        config.className,
        className,
      )}
    >
      <Icon className={size === "md" ? "size-3.5" : "size-3"} strokeWidth={2} />
      {label ?? config.label}
    </span>
  );
}

/** Checklist of the five associations required for a Verified Tenancy. */
export function VerificationChecklist({ checks }: { checks: { label: string; ok: boolean }[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {checks.map((check) => (
        <li key={check.label} className="flex items-center gap-2 text-[12.5px]">
          <span
            className={cn(
              "grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-bold",
              check.ok ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
            )}
          >
            {check.ok ? "✓" : "·"}
          </span>
          <span className={check.ok ? "text-foreground" : "text-muted-foreground"}>
            {check.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

export const TRUST_LABELS = TRUST;
