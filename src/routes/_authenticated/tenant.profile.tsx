import { createFileRoute, Link } from "@tanstack/react-router";

import {
  AppShell,
  DemoNotice,
  EmptyState,
  Eyebrow,
  Glass,
  InlineError,
  ListRow,
  LoadingCard,
  PageHeader,
  SectionCard,
  StatusPill,
  SummaryGrid,
  TrustBadge,
  VerificationChecklist,
} from "@/components/rentid/patterns";
import { useProfile } from "@/lib/auth";
import { money, shortDate } from "@/lib/format";
import { useMyTenancies } from "@/lib/rentid";
import { tenancyVerification } from "@/lib/services/tenancies";

export const Route = createFileRoute("/_authenticated/tenant/profile")({
  head: () => ({
    meta: [{ title: "Rental profile — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: TenantProfilePage,
});

function TenantProfilePage() {
  const profile = useProfile();
  const tenancies = useMyTenancies();

  const rows = tenancies.data ?? [];
  const payments = rows.flatMap((t) => t.payments);
  const onTime = payments.filter(
    (p) => p.status === "paid" && (!p.paid_at || p.paid_at.slice(0, 10) <= p.due_date),
  ).length;
  const paid = payments.filter((p) => p.status === "paid");
  const totalPaid = paid.reduce((sum, p) => sum + Number(p.amount), 0);
  const verifiedCount = rows.filter((t) => t.verified).length;

  return (
    <AppShell subtitle="Tenant">
      <PageHeader
        title="Rental profile"
        subtitle={profile.data?.full_name ?? undefined}
        action={
          <Link
            to="/settings"
            className="rounded-full bg-secondary px-4 py-2 font-display text-[12px] font-semibold"
          >
            Edit details
          </Link>
        }
      />

      <div className="mt-5 space-y-4">
        {tenancies.isLoading ? (
          <LoadingCard label="Building your rental profile…" />
        ) : tenancies.isError ? (
          <InlineError
            message="Your profile could not be loaded."
            onRetry={() => void tenancies.refetch()}
          />
        ) : (
          <>
            <SummaryGrid
              items={[
                {
                  label: "Verified tenancies",
                  value: String(verifiedCount),
                  tone: verifiedCount > 0 ? "success" : "neutral",
                },
                {
                  label: "On-time payments",
                  value: String(onTime),
                  tone: "success",
                  hint: `${paid.length} recorded`,
                },
                { label: "Rent paid", value: money(totalPaid), tone: "neutral" },
                {
                  label: "Records",
                  value: String(payments.length),
                  tone: "neutral",
                  hint: "Payment history",
                },
              ]}
            />

            <DemoNotice>
              Your rental history stays yours. RentID records verified tenancies and payments — no
              scoring, no screening, and nothing shared without a landlord relationship.
            </DemoNotice>

            <Glass className="p-5">
              <Eyebrow>Identity</Eyebrow>
              <p className="mt-1 font-display text-[17px] font-semibold">
                {profile.data?.full_name ?? "—"}
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {profile.data?.email ?? ""}
              </p>
              {profile.data?.phone ? (
                <p className="text-[12.5px] text-muted-foreground">{profile.data.phone}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <TrustBadge kind={verifiedCount > 0 ? "platform_verified" : "unverified"} />
                {verifiedCount > 0 ? <TrustBadge kind="verified_tenancy" /> : null}
              </div>
            </Glass>

            {rows.length === 0 ? (
              <EmptyState
                title="No tenancy history yet"
                description="Accept a landlord invitation and your verified tenancy record starts building here."
              />
            ) : (
              rows.map((tenancy) => {
                const verification = tenancyVerification(tenancy);
                return (
                  <SectionCard
                    key={tenancy.id}
                    title={tenancy.property?.name ?? "Tenancy"}
                    aside={tenancy.unit?.name ?? undefined}
                  >
                    <div className="space-y-4 px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <TrustBadge
                          kind={verification.complete ? "verified_tenancy" : "unverified"}
                        />
                        <StatusPill
                          status={tenancy.status}
                          tone={tenancy.status === "active" ? "success" : "neutral"}
                        />
                      </div>
                      <VerificationChecklist checks={verification.checks} />
                    </div>
                    <ListRow
                      title="Term"
                      subtitle={[shortDate(tenancy.start_date), shortDate(tenancy.end_date)]
                        .filter(Boolean)
                        .join(" → ")}
                      value={
                        tenancy.monthly_rent != null
                          ? `${money(Number(tenancy.monthly_rent))}/mo`
                          : undefined
                      }
                    />
                    <ListRow
                      title="Payments recorded"
                      subtitle="Verified by RentID from your rent ledger"
                      value={String(tenancy.payments.filter((p) => p.status === "paid").length)}
                    />
                  </SectionCard>
                );
              })
            )}

            <SectionCard title="Coming with the full launch">
              <div className="space-y-2 px-4 py-3 text-[12.5px] text-muted-foreground">
                <p>Portable rental references you can share with a future landlord.</p>
                <p>Two-way reviews with dispute handling — landlords and tenants both on record.</p>
              </div>
            </SectionCard>
          </>
        )}
      </div>
    </AppShell>
  );
}
