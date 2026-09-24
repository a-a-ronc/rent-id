/**
 * Property ownership & authorized-representative trust UI.
 *
 * Two positive badges only. There is deliberately no "Unverified" badge — a
 * property without an established chain simply shows no badge, plus neutral
 * text where money or a legal commitment is involved.
 */
import { BadgeCheck, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button, Modal } from "@/components/rentid/kit";
import { useAuth } from "@/lib/auth";
import { useAcknowledgeDisclosure, useDisclosureRequirement } from "@/lib/rentid";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DisclosureContext, PropertyVerification } from "@/lib/types";

const NOT_VERIFIED_NOTE = "Property ownership has not been verified by RentID.";

export function PropertyVerificationBadge({
  verification,
  size = "sm",
  className,
}: {
  verification: PropertyVerification | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!verification?.badge) return null;
  const owner = verification.badge === "ownership_verified";
  const Icon = owner ? BadgeCheck : ShieldCheck;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-display font-medium whitespace-nowrap",
        owner
          ? "bg-success/10 text-success ring-1 ring-success/20"
          : "bg-brand/10 text-brand ring-1 ring-brand/20",
        size === "md" ? "px-3 py-1.5 text-[12px]" : "px-2.5 py-1 text-[10.5px]",
        className,
      )}
    >
      <Icon className={size === "md" ? "size-3.5" : "size-3"} strokeWidth={2} />
      {owner ? "Property Ownership Verified" : "Authorized Representative for Property"}
    </span>
  );
}

/** Badge plus a tap target that explains exactly what RentID established. */
export function PropertyVerificationBadgeButton({
  verification,
  size = "sm",
}: {
  verification: PropertyVerification | null | undefined;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  if (!verification?.badge) return null;
  const owner = verification.badge === "ownership_verified";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="cursor-pointer">
        <PropertyVerificationBadge verification={verification} size={size} />
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={owner ? "Property Ownership Verified" : "Authorized Representative for Property"}
      >
        <div className="space-y-3 text-[13px] leading-relaxed">
          {verification.recorded_owner_name ? (
            <p>
              <span className="text-muted-foreground">
                {owner ? "Recorded owner" : "Representing"}
              </span>
              <br />
              <span className="font-medium">{verification.recorded_owner_name}</span>
            </p>
          ) : null}
          {!owner && verification.representative_name ? (
            <p>
              <span className="text-muted-foreground">Representative</span>
              <br />
              <span className="font-medium">{verification.representative_name}</span>
            </p>
          ) : null}
          {verification.verified_at ? (
            <p>
              <span className="text-muted-foreground">
                {owner ? "Verified by RentID" : "Authority verified"}
              </span>
              <br />
              <span className="font-medium">{shortDate(verification.verified_at)}</span>
            </p>
          ) : null}
          <p className="text-muted-foreground">
            {owner
              ? "RentID independently verified the property ownership record and the relationship between the recorded owner and the RentID account associated with this property."
              : "RentID verified this person or company is authorized to act for the property's owner. This badge does not mean the representative personally owns the property."}
          </p>
        </div>
      </Modal>
    </>
  );
}

/** Small neutral line for verified-free properties. Never alarming. */
export function OwnershipNotice({ className }: { className?: string }) {
  return <p className={cn("text-[12px] text-muted-foreground", className)}>{NOT_VERIFIED_NOTE}</p>;
}

const CONTEXT_ACTION: Record<DisclosureContext, string> = {
  application: "submitting this application",
  lease: "signing this lease",
  payment: "sending this payment",
};

/**
 * One-time disclosure before a high-trust action on a property with no badge.
 * Shown once per tenant + property + payee + wording version — not per payment.
 */
export function UnverifiedPropertyDisclosure({
  open,
  context,
  loading,
  onClose,
  onAcknowledge,
}: {
  open: boolean;
  context: DisclosureContext;
  loading?: boolean;
  onClose: () => void;
  onAcknowledge: () => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Important: Property Ownership Has Not Been Verified"
    >
      <div className="space-y-3 text-[13px] leading-relaxed">
        <p>
          RentID has not been able to independently verify that the person or company associated
          with this property is the legal owner of the property or an authorized representative of
          the legal owner.
        </p>
        <p>
          This does not necessarily mean that the listing, landlord, or property manager is
          illegitimate. However, you should independently verify who you are dealing with before
          sending money or entering into a rental agreement.
        </p>
        <p className="text-muted-foreground">
          Before paying a security deposit, rent, application-related funds, or any other payment,
          RentID strongly recommends that you:
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
          <li>Verify the identity of the landlord or property manager.</li>
          <li>Confirm that the person or company has legal authority to rent this property.</li>
          <li>
            Review and sign a complete lease identifying the property, landlord, rent amount,
            security deposit, and other important terms.
          </li>
          <li>
            Independently confirm that the property exists and is actually available for rent.
          </li>
          <li>
            Whenever possible, meet the landlord or authorized representative and inspect the
            property before sending substantial funds.
          </li>
          <li>
            Be cautious if you are pressured to send money immediately, communicate only through
            unusual channels, or make payments outside normal rental practices.
          </li>
        </ul>
        <p className="text-muted-foreground">
          A signed lease, access to the property, communication with a purported landlord, or
          payment through RentID does not by itself establish legal ownership or authority to rent
          the property. RentID is providing rental-management and payment tools for this transaction
          but is not representing that ownership of this property has been verified.
        </p>
        <label className="flex items-start gap-2.5 rounded-xl bg-muted/50 p-3 text-[13px]">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--brand)]"
          />
          <span>I understand and wish to continue.</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!checked || Boolean(loading)}
            loading={Boolean(loading)}
            onClick={onAcknowledge}
          >
            Continue to {CONTEXT_ACTION[context]}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Gate a high-trust action (apply, sign, pay) behind the one-time ownership
 * disclosure. Verified properties pass straight through.
 */
export function useTrustGate(propertyId: string | null, context: DisclosureContext) {
  const requirement = useDisclosureRequirement(propertyId, context);
  const acknowledge = useAcknowledgeDisclosure();
  const { user } = useAuth();
  const [pending, setPending] = useState<(() => void) | null>(null);

  function guard(action: () => void) {
    if (requirement.data?.required) {
      setPending(() => action);
      return;
    }
    action();
  }

  async function accept() {
    const action = pending;
    setPending(null);
    if (user && propertyId) {
      try {
        await acknowledge.mutateAsync({ propertyId, context });
      } catch {
        /* the acknowledgement is recorded best-effort; never block the tenant */
      }
    }
    action?.();
  }

  const dialog = (
    <UnverifiedPropertyDisclosure
      open={pending !== null}
      context={context}
      loading={acknowledge.isPending}
      onClose={() => setPending(null)}
      onAcknowledge={() => void accept()}
    />
  );

  return {
    guard,
    dialog,
    verified: requirement.data?.verified ?? false,
    badge: requirement.data?.badge ?? null,
    notice: requirement.data && !requirement.data.verified ? requirement.data.notice : null,
  };
}

/**
 * Neutral inline notice for tenant surfaces (lease, payments) where money or a
 * commitment is involved but there is no single blocking action.
 */
export function DisclosureNotice({
  propertyId,
  context,
  className,
}: {
  propertyId: string | null;
  context: DisclosureContext;
  className?: string;
}) {
  const requirement = useDisclosureRequirement(propertyId, context);
  const acknowledge = useAcknowledgeDisclosure();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!requirement.data || requirement.data.verified) return null;
  return (
    <div className={cn("rounded-2xl border border-border/70 px-3.5 py-3", className)}>
      <OwnershipNotice />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-[12px] font-medium text-brand"
      >
        What this means before you pay or sign
      </button>
      <UnverifiedPropertyDisclosure
        open={open}
        context={context}
        loading={acknowledge.isPending}
        onClose={() => setOpen(false)}
        onAcknowledge={() => {
          setOpen(false);
          if (user && propertyId)
            void acknowledge.mutateAsync({ propertyId, context }).catch(() => {});
        }}
      />
    </div>
  );
}
