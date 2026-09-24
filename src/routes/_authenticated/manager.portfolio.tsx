import { createFileRoute, Link } from "@tanstack/react-router";

import {
  AppShell,
  ListRow,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@/components/rentid/patterns";
import { InlineError, LoadingCard } from "@/components/rentid/kit";
import { EmptyState } from "@/components/rentid/Surface";
import { money } from "@/lib/format";
import { useManagedProperties, useManagementOrg } from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/manager/portfolio")({
  head: () => ({
    meta: [{ title: "Managed portfolio — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: ManagerPortfolio,
});

function ManagerPortfolio() {
  const active = useManagementOrg();
  const properties = useManagedProperties(active.orgId);

  return (
    <AppShell subtitle="Property manager" role="manager">
      <PageHeader
        title="Managed portfolio"
        subtitle={
          active.org
            ? `${active.org.name} · authority granted by each owner`
            : "Properties you're authorized to operate"
        }
      />

      <div className="mt-5 space-y-3">
        {properties.isPending ? (
          <LoadingCard label="Loading portfolio…" rows={4} />
        ) : properties.isError ? (
          <InlineError
            message="We couldn't load the portfolio."
            onRetry={() => void properties.refetch()}
          />
        ) : properties.data && properties.data.length > 0 ? (
          properties.data.map((property) => {
            const occupied = property.units.filter((u) => u.occupancy_status === "occupied").length;
            const rentRoll = property.units.reduce((sum, u) => sum + (u.monthly_rent ?? 0), 0);
            return (
              <SectionCard
                key={property.id}
                title={property.name}
                aside={`${occupied}/${property.units.length} occupied · ${money(rentRoll)} rent roll`}
                footer={
                  <Link
                    to="/properties/$propertyId"
                    params={{ propertyId: property.id }}
                    className="text-[12.5px] font-medium text-accent"
                  >
                    Open property
                  </Link>
                }
              >
                {property.units.map((unit, i) => (
                  <ListRow
                    key={unit.id}
                    title={unit.name}
                    subtitle={`${unit.bedrooms ?? "—"} bd · ${unit.bathrooms ?? "—"} ba · ${
                      unit.square_feet ? `${unit.square_feet} sq ft` : "size on file"
                    }`}
                    value={money(unit.monthly_rent)}
                    pill={
                      <StatusPill
                        status={unit.occupancy_status.replace("_", " ")}
                        tone={unit.occupancy_status === "occupied" ? "success" : "warning"}
                      />
                    }
                    delay={i * 30}
                  />
                ))}
              </SectionCard>
            );
          })
        ) : (
          <EmptyState
            title="No managed properties"
            description="Add an owner and record the properties they've authorized you to manage."
            action={
              <Link to="/manager/owners" className="text-[13px] font-medium text-accent">
                Go to owners
              </Link>
            }
          />
        )}
      </div>
    </AppShell>
  );
}
