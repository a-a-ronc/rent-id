import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { FileText, Wrench } from "lucide-react";

import {
  AppShell,
  ListRow,
  PageHeader,
  SectionCard,
  StatusPill,
  TrustBadge,
} from "@/components/rentid/patterns";
import { EmptyState, Glass, Eyebrow } from "@/components/rentid/Surface";
import { useProfile } from "@/lib/auth";
import { greeting, money, shortDate } from "@/lib/format";
import {
  useAcceptInvitation,
  useConversations,
  useInvalidateRentId,
  useMyInvitations,
  useMyTenancies,
} from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/tenant/")({
  head: () => ({
    meta: [{ title: "My home — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: TenantHome,
});

function TenantHome() {
  const profile = useProfile();
  const invitations = useMyInvitations();
  const tenancies = useMyTenancies();
  const accept = useAcceptInvitation();
  const invalidate = useInvalidateRentId();

  const activeTenancy =
    (tenancies.data ?? []).find((t) => t.status === "active") ?? (tenancies.data ?? [])[0];
  const conversations = useConversations({
    tenancyIds: (tenancies.data ?? []).map((t) => t.id),
    viewerRole: "tenant",
  });

  const upcomingRent = activeTenancy
    ? [...activeTenancy.payments]
        .filter((p) => p.status !== "paid")
        .sort((a, b) => a.due_date.localeCompare(b.due_date))[0]
    : undefined;

  const openMaintenance = activeTenancy
    ? activeTenancy.maintenance.filter(
        (m) => m.status === "open" || m.status === "in_progress" || m.status === "acknowledged",
      )
    : [];

  const recentMessages = (conversations.data ?? []).slice(0, 3);

  return (
    <AppShell subtitle="Tenant">
      <PageHeader title={greeting(profile.data?.full_name)} subtitle="Your rental record" />

      {(invitations.data ?? []).length > 0 && (
        <SectionCard title="Pending invitations" aside="Action needed" className="mt-5">
          {(invitations.data ?? []).map((inv) => (
            <ListRow
              key={inv.id}
              title={inv.organization?.name ?? "A landlord"}
              subtitle={`${inv.property?.name ?? ""} ${inv.unit?.name ?? ""}`.trim()}
              value={
                <button
                  onClick={() =>
                    accept.mutate(inv.id, {
                      onSuccess: () => {
                        toast.success("Tenancy verified — welcome home.");
                        invalidate();
                      },
                      onError: (err) =>
                        toast.error(err instanceof Error ? err.message : "Could not accept."),
                    })
                  }
                  disabled={accept.isPending}
                  className="shrink-0 rounded-full bg-brand px-3.5 py-1.5 font-display text-[11.5px] font-semibold text-brand-foreground"
                >
                  {accept.isPending ? "…" : "Accept"}
                </button>
              }
            />
          ))}
        </SectionCard>
      )}

      {tenancies.isLoading ? (
        <div className="mt-5">
          <EmptyState title="Loading…" description="Fetching your rental record." />
        </div>
      ) : !activeTenancy ? (
        <div className="mt-5">
          <EmptyState
            title="No tenancy yet"
            description="When your landlord invites you to a unit, your verified tenancy, lease and rent history will appear here."
          />
        </div>
      ) : (
        <>
          <Glass className="mt-5 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Eyebrow>{activeTenancy.organization?.name ?? "Your landlord"}</Eyebrow>
                <h2 className="mt-1 font-display text-[18px] font-semibold tracking-tight">
                  {activeTenancy.property?.name ?? ""} {activeTenancy.unit?.name ?? ""}
                </h2>
              </div>
              {activeTenancy.verified ? (
                <TrustBadge kind="verified_tenancy" />
              ) : (
                <StatusPill status="Pending" tone="warning" />
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link
                to="/tenant/pay"
                className="rounded-xl bg-brand px-4 py-2.5 text-center text-[13px] font-semibold text-brand-foreground transition-opacity hover:opacity-90"
              >
                View payments
              </Link>
              <Link
                to="/tenant/maintenance"
                className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-[13px] font-medium"
              >
                <Wrench className="size-4" /> Report an issue
              </Link>
            </div>
          </Glass>

          {upcomingRent && (
            <SectionCard title="Rent" aside="Next payment" className="mt-4">
              <ListRow
                title={`Due ${shortDate(upcomingRent.due_date)}`}
                subtitle={
                  upcomingRent.status === "late"
                    ? "Past due — please contact your landlord"
                    : "Recorded by your landlord"
                }
                value={money(upcomingRent.amount)}
                pill={
                  <StatusPill
                    status={upcomingRent.status}
                    tone={upcomingRent.status === "late" ? "danger" : "neutral"}
                  />
                }
              />
            </SectionCard>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link
              to="/tenant/tenancy"
              className="glass rounded-2xl p-4 transition-opacity hover:opacity-90"
            >
              <p className="font-display text-[13px] font-semibold">My tenancy</p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">Unit, term & verification</p>
            </Link>
            <Link
              to="/tenant/lease"
              className="glass rounded-2xl p-4 transition-opacity hover:opacity-90"
            >
              <FileText className="size-4 text-accent" />
              <p className="mt-1.5 font-display text-[13px] font-semibold">Lease</p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">Terms & documents</p>
            </Link>
          </div>

          {openMaintenance.length > 0 && (
            <SectionCard title="Open requests" aside="Maintenance" className="mt-4">
              {openMaintenance.map((m) => (
                <ListRow
                  key={m.id}
                  title={m.title}
                  pill={<StatusPill status={m.status.replace("_", " ")} tone="warning" />}
                />
              ))}
            </SectionCard>
          )}

          <SectionCard
            title="Messages"
            aside={`${recentMessages.length} conversations`}
            className="mt-4"
          >
            {recentMessages.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-muted-foreground">No messages yet.</p>
            ) : (
              recentMessages.map((c) => (
                <ListRow
                  key={c.id}
                  title={c.subject}
                  subtitle={c.messages[c.messages.length - 1]?.body ?? ""}
                  value={
                    c.unread > 0 ? (
                      <StatusPill status={`${c.unread} new`} tone="accent" />
                    ) : undefined
                  }
                />
              ))
            )}
          </SectionCard>
        </>
      )}
    </AppShell>
  );
}
