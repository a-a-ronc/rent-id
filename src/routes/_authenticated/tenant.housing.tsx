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
import { Button, Field, Modal, Select, TextInput } from "@/components/rentid/kit";
import { EmptyState, Eyebrow, Glass, Pill } from "@/components/rentid/Surface";
import { useAuth } from "@/lib/auth";
import { money, shortDate } from "@/lib/format";
import { useCreateLeaseChangeRequest, useResidentHousing } from "@/lib/rentid";
import type { LeaseChangeType } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/tenant/housing")({
  head: () => ({
    meta: [{ title: "My student housing — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: ResidentHousingPage,
});

const REQUEST_TYPES: { value: LeaseChangeType; label: string }[] = [
  { value: "sublease", label: "Sublease my bed" },
  { value: "replacement_resident", label: "Find a replacement resident" },
  { value: "bed_transfer", label: "Transfer to another bed" },
  { value: "renewal", label: "Renew for the next academic year" },
  { value: "early_termination", label: "End my lease early" },
  { value: "guarantor_change", label: "Change my guarantor" },
  { value: "payment_plan", label: "Request a payment plan" },
];

function ResidentHousingPage() {
  const { user } = useAuth();
  const housing = useResidentHousing(user?.id);
  const createRequest = useCreateLeaseChangeRequest();
  const [open, setOpen] = useState(false);
  const [requestType, setRequestType] = useState<LeaseChangeType>("sublease");
  const [reason, setReason] = useState("");
  const [candidate, setCandidate] = useState("");

  const data = housing.data;

  async function submit() {
    if (!data) return;
    if (reason.trim().length < 8) {
      toast.error("Add a short reason so your manager can review it.");
      return;
    }
    try {
      await createRequest.mutateAsync({
        organizationId: data.occupancy.organization_id,
        occupancyId: data.occupancy.id,
        requestType,
        reason: reason.trim(),
        candidateName: candidate.trim() || null,
      });
      toast.success("Request submitted — nothing changes until it is approved.");
      setOpen(false);
      setReason("");
      setCandidate("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit the request");
    }
  }

  return (
    <AppShell subtitle="Tenant">
      <PageHeader
        title="My student housing"
        subtitle={data ? `${data.property_name} · ${data.unit_name}` : undefined}
        action={data ? <Button onClick={() => setOpen(true)}>Request a change</Button> : undefined}
      />

      {housing.isLoading ? (
        <Glass className="mt-5 p-5 text-sm text-muted-foreground">Loading your housing…</Glass>
      ) : !data ? (
        <div className="mt-5">
          <EmptyState
            title="No student housing on your account"
            description="This view appears when your bed or room is part of a student-housing property. Sign in with the student demo account to see it."
          />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <Glass className="p-4 text-sm text-muted-foreground">
            Money shown here is yours alone — a roommate&apos;s balance is never visible to you, and
            requests take effect only after approvals, documents, signatures and payment all land.
          </Glass>

          <SummaryGrid
            items={[
              {
                label: "My balance",
                value: money(data.balance),
                hint: data.term_label ?? "Current term",
              },
              {
                label: "My bed",
                value: data.bed
                  ? `${data.bed.bed_label} · ${data.bed.room_label}`
                  : `${data.occupancy.share_pct ?? 0}% joint share`,
                hint: data.campus ?? "Student housing",
              },
              {
                label: "Roommates",
                value: String(data.roommates.length),
                hint: data.lease_model.replace(/_/g, " "),
              },
              {
                label: "Open requests",
                value: String(data.requests.filter((r) => r.state !== "completed").length),
              },
            ]}
          />

          <SectionCard title="My charges" aside="What I owe">
            {data.charges.length === 0 ? (
              <EmptyState
                title="No charges yet"
                description="Charges appear as your term is billed."
              />
            ) : (
              <div className="divide-y divide-border/60">
                {data.charges.map((charge) => (
                  <ListRow
                    key={charge.id}
                    title={charge.label}
                    subtitle={`Due ${shortDate(charge.due_date)} · ${charge.source_status}`}
                    value={
                      <div className="flex items-center gap-2">
                        <span className="font-display font-semibold">{money(charge.balance)}</span>
                        <StatusPill
                          tone={
                            charge.balance === 0
                              ? "success"
                              : charge.gated_on_request_id
                                ? "neutral"
                                : "warning"
                          }
                          status={
                            charge.balance === 0
                              ? "Settled"
                              : charge.gated_on_request_id
                                ? "Gated"
                                : "Due"
                          }
                        />
                      </div>
                    }
                  />
                ))}
              </div>
            )}
          </SectionCard>

          <div className="grid gap-5 lg:grid-cols-2">
            <SectionCard title="Who pays" aside="Payers separate from the lease">
              {data.payers.length === 0 ? (
                <EmptyState
                  title="No payers on file"
                  description="You or an authorized payer can be added."
                />
              ) : (
                <div className="divide-y divide-border/60">
                  {data.payers.map((payer) => (
                    <ListRow
                      key={payer.id}
                      title={payer.name}
                      subtitle={payer.kind.replace(/_/g, " ")}
                      value={<Pill>{payer.authorized ? "Authorized" : "Not authorized"}</Pill>}
                    />
                  ))}
                </div>
              )}
              {data.guarantors.length > 0 && (
                <div className="mt-3 space-y-1">
                  <Eyebrow>Guarantor</Eyebrow>
                  {data.guarantors.map((g) => (
                    <p key={g.id} className="text-sm text-muted-foreground">
                      {g.name} · {g.signed_at ? "signed" : "signature pending"}
                    </p>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="My roommates" aside="Names only">
              {data.roommates.length === 0 ? (
                <EmptyState
                  title="No roommates"
                  description="You are the only resident in this unit."
                />
              ) : (
                <div className="divide-y divide-border/60">
                  {data.roommates.map((r) => (
                    <ListRow
                      key={r.name}
                      title={r.name}
                      subtitle={
                        r.bed_label ? `Bed ${r.bed_label}` : `${r.share_pct ?? 0}% joint share`
                      }
                      value={<Pill>{r.verified ? "Verified" : "Unverified"}</Pill>}
                    />
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title="My requests"
            aside={
              data.renewal_deadline
                ? `Renewal deadline ${shortDate(data.renewal_deadline)}`
                : "Approval-first"
            }
          >
            {data.requests.length === 0 ? (
              <EmptyState
                title="No requests"
                description="Subleases, replacements, transfers and renewals all start here and are reviewed before anything changes."
              />
            ) : (
              <div className="divide-y divide-border/60">
                {data.requests.map((r) => (
                  <ListRow
                    key={r.id}
                    title={r.request_type.replace(/_/g, " ")}
                    subtitle={r.reason}
                    value={
                      <StatusPill
                        tone={r.state === "denied" ? "danger" : "neutral"}
                        status={r.state.replace(/_/g, " ")}
                      />
                    }
                  />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Maintenance in my unit" aside="Private room and shared areas">
            {data.maintenance.length === 0 ? (
              <EmptyState
                title="Nothing open"
                description="Reported issues appear here with their area and status."
              />
            ) : (
              <div className="divide-y divide-border/60">
                {data.maintenance.map((c) => (
                  <ListRow
                    key={c.id}
                    title={c.issue}
                    subtitle={`${c.area_label} · reported by ${c.requester_name}`}
                    value={
                      <StatusPill
                        tone={c.status === "disputed" ? "danger" : "neutral"}
                        status={c.status.replace(/_/g, " ")}
                      />
                    }
                  />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="My payment history" aside="Append-only">
            {data.events.length === 0 ? (
              <EmptyState
                title="No activity yet"
                description="Every charge and payment is recorded here permanently."
              />
            ) : (
              <div className="divide-y divide-border/60">
                {data.events.map((e) => (
                  <ListRow
                    key={e.id}
                    title={e.kind.replace(/_/g, " ")}
                    subtitle={`${shortDate(e.created_at)}${e.note ? ` · ${e.note}` : ""}`}
                    value={<span className="font-display font-semibold">{money(e.amount)}</span>}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Request a lease change"
        description="Your manager reviews every request. Nothing takes effect until it is approved."
      >
        <div className="space-y-3">
          <Field label="Request type">
            <Select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as LeaseChangeType)}
            >
              {REQUEST_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason">
            <TextInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Study abroad next semester"
            />
          </Field>
          <Field label="Candidate name (optional)">
            <TextInput
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
              placeholder="Person taking over the bed"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button tone="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={createRequest.isPending} onClick={submit}>
              Submit request
            </Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
