import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import {
  AppShell,
  ListRow,
  PageHeader,
  SectionCard,
  StatusPill,
  SummaryGrid,
} from "@/components/rentid/patterns";
import { Button, Field, LoadingCard, Modal, Select, TextArea } from "@/components/rentid/kit";
import { EmptyState } from "@/components/rentid/Surface";
import { useAuth } from "@/lib/auth";
import { shortDate } from "@/lib/format";
import { useDecideVerificationCase, useVerificationQueue } from "@/lib/rentid";
import { CLAIM_LABELS, providerStatusList } from "@/lib/services/verification";
import type { ReviewDecision } from "@/lib/services/verification";

export const Route = createFileRoute("/_authenticated/admin/verification")({
  head: () => ({
    meta: [{ title: "Ownership review — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminVerification,
});

const DECISIONS: [ReviewDecision, string][] = [
  ["verify_ownership", "Approve — property ownership verified"],
  ["verify_representative", "Approve — authorized representative for property"],
  ["request_information", "Request more information"],
  ["keep_pending", "Keep in review"],
  ["unable_to_verify", "Unable to verify"],
  ["suspend", "Suspend verification"],
  ["fraud_escalation", "Escalate for fraud review"],
];

function AdminVerification() {
  const { roles } = useAuth();
  const queue = useVerificationQueue();
  const decide = useDecideVerificationCase();
  const providers = providerStatusList();

  const [caseId, setCaseId] = useState<string | null>(null);
  const [decision, setDecision] = useState<ReviewDecision>("request_information");
  const [reason, setReason] = useState("");

  if (!roles.includes("admin")) {
    return (
      <AppShell subtitle="Administration">
        <EmptyState
          title="Administrator access only"
          description="Ownership review is limited to RentID administrators, and every decision is recorded."
        />
      </AppShell>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!caseId) return;
    try {
      await decide.mutateAsync({ caseId, decision, reason });
      toast.success("Decision recorded.");
      setCaseId(null);
      setReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the decision.");
    }
  }

  const items = queue.data ?? [];

  return (
    <AppShell subtitle="Administration">
      <PageHeader
        title="Property ownership review"
        subtitle="Each decision is property-specific and recorded with the reviewer and reason."
      />

      <div className="mt-5">
        <SummaryGrid
          items={[
            { label: "Awaiting review", value: items.length },
            {
              label: "Risk-flagged",
              value: items.filter((i) => i.risk_events.length > 0).length,
              tone: items.some((i) => i.risk_events.length > 0) ? "warning" : "neutral",
            },
            {
              label: "Verification providers live",
              value: providers.filter((p) => p.mode !== "not_configured").length,
              hint: "Badges can only be issued from official records",
            },
          ]}
        />
      </div>

      <SectionCard
        title="Verification data sources"
        aside={`${providers.length} configured`}
        className="mt-5"
      >
        {providers.map((p) => (
          <ListRow
            key={p.id}
            title={p.label}
            subtitle={
              p.mode === "not_configured"
                ? "Not configured — claims relying on this source go to manual review."
                : "Configured for official record lookups."
            }
            pill={
              <StatusPill
                status={p.mode.replace(/_/g, " ")}
                tone={p.mode === "not_configured" ? "warning" : "success"}
              />
            }
          />
        ))}
      </SectionCard>

      <div className="mt-5 space-y-3">
        {queue.isPending ? (
          <LoadingCard label="Loading review queue…" rows={3} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing awaiting review"
            description="New claims and risk events appear here."
          />
        ) : (
          items.map((item) => (
            <SectionCard
              key={item.case.id}
              title={item.property_name}
              aside={shortDate(item.case.created_at)}
              footer={
                <Button
                  size="sm"
                  onClick={() => {
                    setCaseId(item.case.id);
                    setDecision("request_information");
                  }}
                >
                  Record a decision
                </Button>
              }
            >
              <ListRow title="Address" subtitle={item.property_address} />
              <ListRow
                title="Claimant"
                subtitle={`${item.case.claimant_name} · ${CLAIM_LABELS[item.case.claim_relationship]}`}
                pill={<StatusPill status={item.case.status} tone="warning" />}
              />
              <ListRow
                title="Recorded owner"
                subtitle={item.recorded_owner_name ?? "No recorded owner on file"}
              />
              <ListRow
                title="Confidence"
                subtitle={`Property ${item.case.property_confidence} · Identity ${item.case.identity_confidence} · Authority ${item.case.authority_confidence}`}
              />
              {item.case.contradictions.map((note) => (
                <ListRow key={note} title="Contradiction" subtitle={note} />
              ))}
              {item.evidence.map((ev) => (
                <ListRow
                  key={ev.id}
                  title={ev.evidence_type.replace(/_/g, " ")}
                  subtitle={`${ev.summary} · ${ev.source_type.replace(/_/g, " ")} · ${ev.strength}`}
                />
              ))}
              {item.risk_events.map((risk) => (
                <ListRow
                  key={risk.id}
                  title="Risk signal"
                  subtitle={risk.detail}
                  pill={<StatusPill status={risk.severity} tone="danger" />}
                />
              ))}
            </SectionCard>
          ))
        )}
      </div>

      <Modal
        open={caseId !== null}
        onClose={() => setCaseId(null)}
        title="Record a review decision"
      >
        <form onSubmit={submit} className="space-y-3.5">
          <Field label="Decision">
            <Select
              value={decision}
              onChange={(e) => setDecision(e.target.value as ReviewDecision)}
            >
              {DECISIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason" hint="Required, stored with your reviewer ID">
            <TextArea
              rows={3}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={decide.isPending} className="w-full">
            Record decision
          </Button>
        </form>
      </Modal>
    </AppShell>
  );
}
