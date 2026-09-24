/**
 * Ownership & authority panel on the existing property detail page.
 *
 * Shows the owner-facing internal state (which is richer than the public
 * badge), lets the claimant add evidence, and lets a verified owner grant or
 * revoke a property-specific representative authorization.
 */
import { useState } from "react";
import { toast } from "sonner";

import { ListRow, SectionCard, StatusPill } from "@/components/rentid/patterns";
import {
  Button,
  Field,
  FormGrid,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "@/components/rentid/kit";
import {
  OwnershipNotice,
  PropertyVerificationBadgeButton,
} from "@/components/rentid/verification-ui";
import { shortDate } from "@/lib/format";
import {
  useAuthorizeRepresentative,
  usePropertyVerification,
  useRevokeAuthorization,
  useStartPropertyClaim,
  useSubmitVerificationEvidence,
} from "@/lib/rentid";
import { CLAIM_LABELS, PERMISSION_LABELS } from "@/lib/services/verification";
import type {
  PropertyClaimRelationship,
  VerificationCaseStatus,
  VerificationProposition,
} from "@/lib/types";

const STATUS_COPY: Record<
  VerificationCaseStatus,
  { label: string; tone: "success" | "warning" | "danger" | "neutral"; hint: string }
> = {
  pending: {
    label: "Claim started",
    tone: "neutral",
    hint: "Add the recorded deed and a matching ID to continue.",
  },
  collecting_evidence: {
    label: "Collecting evidence",
    tone: "warning",
    hint: "RentID needs the recorded deed, plus supporting parcel or assessor records.",
  },
  manual_review: {
    label: "In RentID review",
    tone: "warning",
    hint: "A RentID reviewer is checking the records. No badge is shown while this is open.",
  },
  ownership_verified: {
    label: "Ownership verified",
    tone: "success",
    hint: "The recorded owner and this account match.",
  },
  authorized_representative_verified: {
    label: "Authority verified",
    tone: "success",
    hint: "You are authorized to act for this property's owner.",
  },
  unable_to_verify: {
    label: "Not verified",
    tone: "danger",
    hint: "RentID could not establish this claim. You can start again with new records.",
  },
  suspended: {
    label: "Verification suspended",
    tone: "danger",
    hint: "Something changed about this property. Reverification is required before badges return.",
  },
  revoked: {
    label: "Authorization revoked",
    tone: "danger",
    hint: "The owner revoked this authority. Badges and permissions were removed.",
  },
  fraud_review: {
    label: "Under review",
    tone: "danger",
    hint: "RentID is reviewing risk signals on this property. No badge is shown.",
  },
};

const EVIDENCE_TYPES: [VerificationProposition, string, string][] = [
  ["property", "recorded_deed", "Recorded deed or transfer document"],
  ["property", "assessor_record", "Assessor / parcel record"],
  ["identity", "government_id", "Government-issued ID"],
  ["identity", "entity_filing", "Business or entity filing"],
  ["authority", "authorization_letter", "Owner authorization letter"],
  ["authority", "management_agreement", "Property management agreement"],
  ["authority", "trustee_document", "Trust or estate appointment document"],
];

export function PropertyVerificationCard({
  propertyId,
  className = "",
}: {
  propertyId: string;
  className?: string;
}) {
  const verification = usePropertyVerification(propertyId);
  const startClaim = useStartPropertyClaim();
  const submitEvidence = useSubmitVerificationEvidence();
  const authorize = useAuthorizeRepresentative();
  const revoke = useRevokeAuthorization();

  const [claimOpen, setClaimOpen] = useState(false);
  const [relationship, setRelationship] = useState<PropertyClaimRelationship>("individual_owner");
  const [claimantName, setClaimantName] = useState("");

  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceIndex, setEvidenceIndex] = useState("0");
  const [summary, setSummary] = useState("");

  const [authOpen, setAuthOpen] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [repName, setRepName] = useState("");

  const v = verification.data;
  const c = v?.case ?? null;
  const status = c ? STATUS_COPY[c.status] : null;
  const activeAuthorizations = (v?.authorizations ?? []).filter((a) => a.status === "active");

  async function submitClaim(e: React.FormEvent) {
    e.preventDefault();
    try {
      await startClaim.mutateAsync({
        propertyId,
        relationship,
        claimantName: claimantName || null,
      });
      toast.success("Ownership claim started.");
      setClaimOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the claim.");
    }
  }

  async function submitEvidenceForm(e: React.FormEvent) {
    e.preventDefault();
    if (!c) return;
    const pick = EVIDENCE_TYPES[Number(evidenceIndex)];
    if (!pick) return;
    try {
      await submitEvidence.mutateAsync({
        caseId: c.id,
        proposition: pick[0],
        evidenceType: pick[1],
        summary: summary.trim() || pick[2],
      });
      toast.success("Evidence submitted for review.");
      setSummary("");
      setEvidenceOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit the evidence.");
    }
  }

  async function submitAuthorization(e: React.FormEvent) {
    e.preventDefault();
    try {
      await authorize.mutateAsync({
        propertyId,
        ownerName: ownerName.trim(),
        representativeName: repName.trim(),
      });
      toast.success("Authorization created for this property only.");
      setOwnerName("");
      setRepName("");
      setAuthOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the authorization.");
    }
  }

  return (
    <SectionCard
      title="Ownership & authority"
      aside={v?.badge ? "Verified" : "Property-specific"}
      className={className}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {c ? (
            <Button tone="secondary" size="sm" onClick={() => setEvidenceOpen(true)}>
              Add evidence
            </Button>
          ) : (
            <Button size="sm" onClick={() => setClaimOpen(true)}>
              Claim this property
            </Button>
          )}
          {v?.badge === "ownership_verified" ? (
            <Button tone="ghost" size="sm" onClick={() => setAuthOpen(true)}>
              Authorize a representative
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
        {v?.badge ? (
          <PropertyVerificationBadgeButton verification={v} size="md" />
        ) : (
          <OwnershipNotice />
        )}
      </div>

      {c ? (
        <>
          <ListRow
            title={status?.label ?? "Claim"}
            subtitle={status?.hint ?? ""}
            pill={<StatusPill status={status?.label ?? ""} tone={status?.tone ?? "neutral"} />}
          />
          <ListRow title="Claimed relationship" subtitle={CLAIM_LABELS[c.claim_relationship]} />
          <ListRow
            title="What RentID has established"
            subtitle={`Property record: ${c.property_confidence} · Claimant identity: ${c.identity_confidence} · Authority: ${c.authority_confidence}`}
          />
          {c.contradictions.length > 0 ? (
            <div className="px-4 py-3">
              <p className="text-[12px] font-medium text-warning">Needs attention</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] text-muted-foreground">
                {c.contradictions.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <ListRow
          title="No ownership claim yet"
          subtitle="Verifying one property never verifies your other properties — each one is checked on its own records."
        />
      )}

      {activeAuthorizations.map((a) => (
        <ListRow
          key={a.id}
          title={a.representative_name}
          subtitle={`${(a.permissions ?? []).map((perm) => PERMISSION_LABELS[perm]).join(", ")}${
            a.expires_at ? ` · expires ${shortDate(a.expires_at)}` : ""
          }`}
          value={
            <Button
              tone="ghost"
              size="sm"
              onClick={() =>
                void revoke
                  .mutateAsync({ authorizationId: a.id, reason: "Revoked by the owner." })
                  .then(() => toast.success("Authorization revoked."))
                  .catch((err: unknown) =>
                    toast.error(err instanceof Error ? err.message : "Could not revoke."),
                  )
              }
            >
              Revoke
            </Button>
          }
        />
      ))}

      <Modal open={claimOpen} onClose={() => setClaimOpen(false)} title="Claim this property">
        <form onSubmit={submitClaim} className="space-y-3.5">
          <Field label="Your relationship to this property">
            <Select
              value={relationship}
              onChange={(e) => setRelationship(e.target.value as PropertyClaimRelationship)}
            >
              {(Object.keys(CLAIM_LABELS) as PropertyClaimRelationship[]).map((key) => (
                <option key={key} value={key}>
                  {CLAIM_LABELS[key]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Legal owner name as recorded">
            <TextInput value={claimantName} onChange={(e) => setClaimantName(e.target.value)} />
          </Field>
          <p className="text-[12px] text-muted-foreground">
            RentID verifies against recorded ownership records. A claim on its own never produces a
            public badge.
          </p>
          <Button type="submit" loading={startClaim.isPending} className="w-full">
            Start verification
          </Button>
        </form>
      </Modal>

      <Modal
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        title="Add verification evidence"
      >
        <form onSubmit={submitEvidenceForm} className="space-y-3.5">
          <Field label="Document type">
            <Select value={evidenceIndex} onChange={(e) => setEvidenceIndex(e.target.value)}>
              {EVIDENCE_TYPES.map(([, , label], i) => (
                <option key={label} value={String(i)}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What this document shows">
            <TextArea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <p className="text-[12px] text-muted-foreground">
            Uploaded documents are treated as unverified until a RentID reviewer checks them, and
            are stored privately — never shown to tenants or on public pages.
          </p>
          <Button type="submit" loading={submitEvidence.isPending} className="w-full">
            Submit for review
          </Button>
        </form>
      </Modal>

      <Modal open={authOpen} onClose={() => setAuthOpen(false)} title="Authorize a representative">
        <form onSubmit={submitAuthorization} className="space-y-3.5">
          <FormGrid>
            <Field label="Owner name">
              <TextInput
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
              />
            </Field>
            <Field label="Representative or company">
              <TextInput required value={repName} onChange={(e) => setRepName(e.target.value)} />
            </Field>
          </FormGrid>
          <p className="text-[12px] text-muted-foreground">
            This authorization applies to this property only, and you can revoke it at any time.
          </p>
          <Button type="submit" loading={authorize.isPending} className="w-full">
            Create authorization
          </Button>
        </form>
      </Modal>
    </SectionCard>
  );
}
