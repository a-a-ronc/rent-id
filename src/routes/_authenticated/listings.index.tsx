import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  AppShell,
  ListRow,
  PageHeader,
  SectionCard,
  StatusPill,
  SummaryGrid,
  ToolbarButton,
} from "@/components/rentid/patterns";
import { Button, DemoNotice, InlineError, LoadingCard, Modal } from "@/components/rentid/kit";
import { EmptyState, Pill } from "@/components/rentid/Surface";
import {
  ListingForm,
  SOURCE_LABELS,
  SourcePill,
  applicationLabel,
  applicationTone,
  emptyListingValues,
  listingCoreFromValues,
  listingDetailFromValues,
  type ListingFormValues,
} from "@/components/rentid/listing-ui";
import { marketplaceName } from "@/lib/syndication/adapters";
import { money, shortDate } from "@/lib/format";
import {
  useActiveOrg,
  useApplications,
  useCreateListing,
  useListingLeads,
  useListingSources,
  useListings,
  useProperties,
  useUnits,
} from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/listings/")({
  head: () => ({
    meta: [{ title: "Listings & distribution — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: ListingsPage,
});

function ListingsPage() {
  const active = useActiveOrg();
  const listings = useListings(active.orgId);
  const applications = useApplications(active.orgId);
  const properties = useProperties(active.orgId);
  const leads = useListingLeads(active.orgId);
  const sources = useListingSources(active.orgId);
  const createListing = useCreateListing();

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ListingFormValues>(emptyListingValues);

  const units = useUnits(values.propertyId || null, active.orgId);
  const listable = useMemo(
    () => (units.data ?? []).filter((u) => u.occupancy_status !== "occupied"),
    [units.data],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!active.orgId || !values.propertyId || !values.unitId) return;
    const core = listingCoreFromValues(values);
    await createListing.mutateAsync({
      organizationId: active.orgId,
      propertyId: values.propertyId,
      unitId: values.unitId,
      headline: core.headline,
      description: core.description,
      monthlyRent: core.monthly_rent,
      securityDeposit: core.security_deposit,
      availableOn: core.available_on,
      leaseTermMonths: core.lease_term_months,
      amenities: core.amenities,
      detail: listingDetailFromValues(values),
      channels: values.channels,
      publish: true,
    });
    setOpen(false);
    setValues(emptyListingValues());
  }

  const rows = listings.data ?? [];
  const published = rows.filter((l) => l.status === "published");
  const apps = applications.data ?? [];

  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader
        title="Listings & distribution"
        subtitle="Create once. Publish everywhere. Manage everything from RentID."
        action={<ToolbarButton label="New listing" onClick={() => setOpen(true)} />}
      />

      {active.isDemo ? (
        <div className="mt-4">
          <DemoNotice>
            Listings and applications are live. Partner networks show "Integration pending" until
            each official feed is approved.
          </DemoNotice>
        </div>
      ) : null}

      <div className="mt-5">
        <SummaryGrid
          items={[
            { label: "Published", value: published.length },
            { label: "Leads", value: leads.data?.length ?? 0 },
            {
              label: "Applications",
              value: apps.length,
              tone: apps.some((a) => a.status === "submitted" || a.status === "new")
                ? "warning"
                : "neutral",
            },
            {
              label: "Approved",
              value: apps.filter((a) => a.status === "approved" || a.status === "lease_signed")
                .length,
              tone: "success",
            },
          ]}
        />
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <SectionCard title="Your listings" aside={`${rows.length} total`}>
          {listings.isPending ? (
            <div className="p-4">
              <LoadingCard rows={3} />
            </div>
          ) : listings.isError ? (
            <div className="p-4">
              <InlineError
                message="Listings unavailable."
                onRetry={() => void listings.refetch()}
              />
            </div>
          ) : rows.length > 0 ? (
            rows.map((listing, i) => (
              <div key={listing.id}>
                <ListRow
                  title={listing.headline}
                  subtitle={`${listing.property?.name ?? "Property"} · ${listing.unit?.name ?? "Unit"} · available ${shortDate(listing.available_on)}`}
                  value={money(listing.monthly_rent)}
                  pill={
                    <StatusPill
                      status={listing.status === "leased" ? "rented" : listing.status}
                      tone={
                        listing.status === "published"
                          ? "success"
                          : listing.status === "leased"
                            ? "accent"
                            : "neutral"
                      }
                    />
                  }
                  delay={i * 40}
                />
                <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                  {listing.channels.filter((c) => c.enabled).length > 0 ? (
                    listing.channels
                      .filter((c) => c.enabled)
                      .map((c) => (
                        <Pill key={c.id} tone={c.listing_status === "live" ? "accent" : "warning"}>
                          {marketplaceName(c.marketplace_id)}
                          {c.listing_status === "live" ? " · live" : " · pending"}
                        </Pill>
                      ))
                  ) : (
                    <Pill>Not distributed</Pill>
                  )}
                  <Pill>{listing.pipeline.views} views</Pill>
                  <Pill>{listing.application_count} applications</Pill>
                  <Link
                    to="/listings/$listingId"
                    params={{ listingId: listing.id }}
                    className="text-[11.5px] font-medium text-accent"
                  >
                    Manage distribution
                  </Link>
                </div>
              </div>
            ))
          ) : (
            <div className="p-4">
              <EmptyState
                title="No listings yet"
                description="Publish a vacant unit once and RentID prepares it for every supported rental network."
                action={<Button onClick={() => setOpen(true)}>New listing</Button>}
              />
            </div>
          )}
        </SectionCard>

        <div className="space-y-3">
          <SectionCard title="Applications" aside={`${apps.length} total`}>
            {applications.isPending ? (
              <div className="p-4">
                <LoadingCard rows={3} />
              </div>
            ) : apps.length > 0 ? (
              apps
                .slice(0, 8)
                .map((application, i) => (
                  <ListRow
                    key={application.id}
                    title={application.applicant_name}
                    subtitle={`${application.property_name} · ${application.unit_name} · from ${SOURCE_LABELS[application.source ?? "rentid"]} · ${shortDate(application.created_at)}`}
                    pill={
                      <StatusPill
                        status={applicationLabel(application.status)}
                        tone={applicationTone(application.status)}
                      />
                    }
                    delay={i * 40}
                  />
                ))
            ) : (
              <ListRow
                title="No applications yet"
                subtitle="Applications appear here as renters apply"
              />
            )}
          </SectionCard>

          <SectionCard title="Where applicants come from" aside="Leads by source">
            {(sources.data ?? []).length > 0 ? (
              (sources.data ?? []).map((row) => (
                <ListRow
                  key={row.source}
                  title={SOURCE_LABELS[row.source]}
                  subtitle={`${row.applications} applications · ${row.signed} signed`}
                  value={row.leads}
                  pill={<SourcePill source={row.source} />}
                />
              ))
            ) : (
              <ListRow title="No leads yet" subtitle="Sources are recorded as traffic arrives" />
            )}
          </SectionCard>
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New listing"
        description="Fill this in once — RentID keeps every channel in sync from here."
      >
        <ListingForm
          mode="create"
          values={values}
          onChange={setValues}
          properties={properties.data ?? []}
          units={listable}
          submitting={createListing.isPending}
          onSubmit={submit}
          onCancel={() => setOpen(false)}
        />
      </Modal>
    </AppShell>
  );
}
