import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell, PageHeader, SectionCard, StatusPill } from "@/components/rentid/patterns";
import {
  Button,
  DemoNotice,
  InlineError,
  LoadingCard,
  Modal,
  TextInput,
  Field,
} from "@/components/rentid/kit";
import { EmptyState, Eyebrow, Glass, Pill } from "@/components/rentid/Surface";
import { money } from "@/lib/format";
import { useDecideLeaseChange, useLeaseChangeRequests, useManagementOrg } from "@/lib/rentid";
import type { LeaseChangeRequestWithContext } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/manager/student/changes")({
  head: () => ({
    meta: [{ title: "Lease changes — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: LeaseChangeInbox,
});

const POLICY_TONE = { allowed: "success", conditional: "warning", prohibited: "danger" } as const;

function LeaseChangeInbox() {
  const active = useManagementOrg();
  const [scope, setScope] = useState<"open" | "all">("open");
  const requests = useLeaseChangeRequests(active.orgId, scope);
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = requests.data ?? [];
  const selected = rows.find((r) => r.id === openId) ?? null;

  return (
    <AppShell subtitle="Property manager" role="manager">
      <PageHeader
        title="Lease change inbox"
        subtitle="Nothing takes effect until approvals, documents, signatures and money all land"
        action={
          <Button tone="secondary" onClick={() => setScope(scope === "open" ? "all" : "open")}>
            {scope === "open" ? "Show all" : "Show open only"}
          </Button>
        }
      />

      <div className="mt-4">
        <DemoNotice>
          Requests follow the approval-first rule: a prohibited request can still be submitted for
          an exception, but it never becomes effective — and no replacement listing goes public —
          without an explicit operator decision.
        </DemoNotice>
      </div>

      <div className="mt-4">
        <SectionCard title="Requests" aside={`${rows.length} shown`}>
          {requests.isLoading ? (
            <div className="p-4">
              <LoadingCard label="Loading requests…" rows={4} />
            </div>
          ) : requests.isError ? (
            <div className="p-4">
              <InlineError
                message="Could not load lease changes."
                onRetry={() => requests.refetch()}
              />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No lease change requests"
              description="Resident requests will appear here for review."
            />
          ) : (
            rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setOpenId(r.id)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium capitalize">
                    {r.request_type.replace(/_/g, " ")} · {r.resident_name}
                  </p>
                  <p className="num mt-0.5 truncate text-[11.5px] text-muted-foreground">
                    {r.property_name} · {r.unit_name}
                    {r.bed_label ? ` · Bed ${r.bed_label}` : ""} ·{" "}
                    {r.checklist.filter((c) => c.done).length}/{r.checklist.length} steps complete
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <StatusPill status={r.policy_mode} tone={POLICY_TONE[r.policy_mode]} />
                  <StatusPill status={r.state.replace(/_/g, " ")} tone="accent" />
                </div>
              </button>
            ))
          )}
        </SectionCard>
      </div>

      <RequestDrawer request={selected} onClose={() => setOpenId(null)} />
    </AppShell>
  );
}

function RequestDrawer({
  request,
  onClose,
}: {
  request: LeaseChangeRequestWithContext | null;
  onClose: () => void;
}) {
  const decide = useDecideLeaseChange();
  const [effectiveDate, setEffectiveDate] = useState("");
  if (!request) return null;

  const act = (action: Parameters<typeof decide.mutate>[0]["action"]) =>
    decide.mutate({
      requestId: request.id,
      action,
      actorName: "Property manager",
      ...(action === "schedule" ? { effectiveDate: effectiveDate || null } : {}),
    });

  const pmApproved = request.steps.some((s) => s.role === "pm" && s.state === "approved");
  const ownerApproved =
    !request.requires_owner_approval ||
    request.steps.some((s) => s.role === "owner" && s.state === "approved");
  const decided = ["denied", "completed"].includes(request.state);

  return (
    <Modal
      open
      onClose={onClose}
      title={`${request.request_type.replace(/_/g, " ")} — ${request.resident_name}`}
      description={`${request.property_name} · ${request.unit_name}${request.bed_label ? ` · Bed ${request.bed_label}` : ""}`}
    >
      <div className="space-y-4">
        <Glass className="p-3">
          <Eyebrow>Reason given</Eyebrow>
          <p className="mt-1 text-[13px]">{request.reason}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill>Policy: {request.policy_mode}</Pill>
            <Pill>SLA {request.sla_hours}h</Pill>
            {request.fee_amount ? <Pill>Fee {money(request.fee_amount)}</Pill> : null}
            {request.candidate_name ? <Pill>Candidate: {request.candidate_name}</Pill> : null}
            <Pill>
              {request.replacement_listing_enabled
                ? "Replacement listing live"
                : "No public listing"}
            </Pill>
          </div>
        </Glass>

        <div>
          <Eyebrow>Approval trail</Eyebrow>
          <div className="mt-2 space-y-1.5">
            {request.steps.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-secondary/50 px-3 py-2"
              >
                <span className="text-[12.5px]">{s.label}</span>
                <StatusPill
                  status={s.state}
                  tone={
                    s.state === "approved" ? "success" : s.state === "denied" ? "danger" : "warning"
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <Eyebrow>Completion checklist</Eyebrow>
          <ul className="mt-2 space-y-1">
            {request.checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-[12.5px]">
                <span className={c.done ? "text-success" : "text-muted-foreground"}>
                  {c.done ? "●" : "○"}
                </span>
                <span className={c.done ? "" : "text-muted-foreground"}>{c.label}</span>
              </li>
            ))}
          </ul>
        </div>

        {!decided ? (
          <div className="space-y-2">
            <Eyebrow>Actions</Eyebrow>
            <div className="flex flex-wrap gap-2">
              {request.state === "submitted" ? (
                <Button onClick={() => act("start_review")}>Start review</Button>
              ) : null}
              {!pmApproved ? (
                <Button onClick={() => act("pm_approve")}>Approve as manager</Button>
              ) : null}
              {pmApproved && !ownerApproved ? (
                <Button onClick={() => act("owner_approve")}>Record owner approval</Button>
              ) : null}
              {pmApproved && ownerApproved && !request.documents_complete ? (
                <Button onClick={() => act("attach_documents")}>Attach documents</Button>
              ) : null}
              {request.documents_complete && !request.signatures_complete ? (
                <Button onClick={() => act("collect_signatures")}>Mark signatures collected</Button>
              ) : null}
              {request.signatures_complete && !request.payment_complete && request.fee_amount ? (
                <Button onClick={() => act("settle_money")}>Release fee &amp; settle</Button>
              ) : null}
              {request.request_type === "replacement_resident" &&
              pmApproved &&
              !request.replacement_listing_enabled ? (
                <Button tone="secondary" onClick={() => act("enable_replacement_listing")}>
                  Allow replacement listing
                </Button>
              ) : null}
              {request.state === "scheduled" ? (
                <Button onClick={() => act("make_effective")}>Make effective</Button>
              ) : null}
              <Button tone="ghost" onClick={() => act("deny")}>
                Deny
              </Button>
            </div>
            <Field label="Effective date">
              <div className="flex gap-2">
                <TextInput
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                />
                <Button tone="secondary" onClick={() => act("schedule")}>
                  Schedule
                </Button>
              </div>
            </Field>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            This request is {request.state}. The decision and its approval trail stay on the record.
          </p>
        )}
      </div>
    </Modal>
  );
}
