import { createFileRoute } from "@tanstack/react-router";

import {
  AppShell,
  PageHeader,
  SectionCard,
  StatusPill,
  SummaryGrid,
} from "@/components/rentid/patterns";
import { Button, DemoNotice, LoadingCard } from "@/components/rentid/kit";
import { EmptyState, Eyebrow, Glass, Pill } from "@/components/rentid/Surface";
import { money } from "@/lib/format";
import { useManagementOrg, useStudentPreLeasing, useUpdateRoommateGroupStage } from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/manager/student/preleasing")({
  head: () => ({
    meta: [{ title: "Pre-leasing — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: PreLeasingPage,
});

function PreLeasingPage() {
  const active = useManagementOrg();
  const data = useStudentPreLeasing(active.orgId);
  const advance = useUpdateRoommateGroupStage();

  if (data.isLoading) {
    return (
      <AppShell subtitle="Property manager" role="manager">
        <LoadingCard label="Loading pre-leasing…" rows={5} />
      </AppShell>
    );
  }

  const s = data.data;
  if (!s) {
    return (
      <AppShell subtitle="Property manager" role="manager">
        <EmptyState
          title="No student properties"
          description="Turn on the student category to start pre-leasing."
        />
      </AppShell>
    );
  }

  return (
    <AppShell subtitle="Property manager" role="manager">
      <PageHeader
        title="Pre-leasing & renewals"
        subtitle={
          s.term
            ? `Next term ${s.term.label} · move-in ${s.term.move_in_on}`
            : "Academic term pipeline"
        }
      />

      <SummaryGrid
        className="mt-4"
        items={[
          {
            label: "Pre-leased",
            value: `${s.pre_leased_pct}%`,
            hint: `${s.pre_leased} of ${s.beds_total} beds`,
          },
          { label: "Renewals pending", value: s.renewals_pending, tone: "warning" },
          { label: "Groups in review", value: s.applications_in_review, tone: "neutral" },
          { label: "Changes pending", value: s.changes_pending, tone: "warning" },
        ]}
      />

      <div className="mt-4">
        <DemoNotice>
          Roommate groups apply together but stay separate people: each member has their own
          profile, guarantor and payment obligation. First-time renters are shown as a first
          verified tenancy — never as a negative signal.
        </DemoNotice>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <Glass className="p-4">
          <Eyebrow>Bed pipeline</Eyebrow>
          <div className="mt-3 space-y-2">
            {s.pipeline.map((row) => (
              <div
                key={row.status}
                className="flex items-center justify-between gap-3 rounded-xl bg-secondary/50 px-3 py-2"
              >
                <span className="text-[13px] capitalize">{row.status.replace(/_/g, " ")}</span>
                <span className="num text-[13px] font-medium">{row.count}</span>
              </div>
            ))}
          </div>
          {s.term ? (
            <div className="mt-4 space-y-1 text-[12.5px] text-muted-foreground">
              <p>Applications open {s.term.application_opens_on}</p>
              <p>Renewal deadline {s.term.renewal_deadline}</p>
              <p>Turn starts {s.term.turn_starts_on}</p>
              <p>Term rent {s.term.term_rent ? money(s.term.term_rent) : "—"}</p>
            </div>
          ) : null}
        </Glass>

        <SectionCard title="Roommate groups" aside={`${s.groups.length} groups`}>
          {s.groups.length === 0 ? (
            <EmptyState
              title="No groups yet"
              description="Group applications for the next term will appear here."
            />
          ) : (
            s.groups.map((g) => (
              <div key={g.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">{g.label}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {g.property_name} · started by {g.created_by_name}
                    </p>
                  </div>
                  <StatusPill status={g.stage.replace(/_/g, " ")} tone="accent" />
                </div>
                <div className="mt-2 space-y-1.5">
                  {g.members.map((m) => (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/50 px-3 py-2"
                    >
                      <span className="text-[12.5px]">{m.name}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {m.first_time_renter ? (
                          <Pill>First verified tenancy</Pill>
                        ) : (
                          <Pill>Rental history shared</Pill>
                        )}
                        <StatusPill
                          status={m.state.replace(/_/g, " ")}
                          tone={m.state === "complete" ? "success" : "warning"}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    tone="secondary"
                    onClick={() => advance.mutate({ groupId: g.id, stage: "screening" })}
                  >
                    Move to screening
                  </Button>
                  <Button
                    tone="secondary"
                    onClick={() => advance.mutate({ groupId: g.id, stage: "approved" })}
                  >
                    Approve group
                  </Button>
                  <Button
                    tone="ghost"
                    onClick={() => advance.mutate({ groupId: g.id, stage: "waitlisted" })}
                  >
                    Waitlist
                  </Button>
                </div>
              </div>
            ))
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
