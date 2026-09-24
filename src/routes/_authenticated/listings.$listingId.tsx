import { createFileRoute, Link, useParams } from "@tanstack/react-router";
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
import { Button, InlineError, LoadingCard, Modal, Select } from "@/components/rentid/kit";
import { Eyebrow, Pill } from "@/components/rentid/Surface";
import {
  APPLICATION_STATUSES,
  ChannelRow,
  ListingForm,
  SOURCE_LABELS,
  applicationLabel,
  applicationTone,
  listingCoreFromValues,
  listingDetailFromValues,
  valuesFromListing,
  type ListingFormValues,
} from "@/components/rentid/listing-ui";
import { publicApplyUrl, publicListingUrl } from "@/lib/syndication/adapters";
import { fullDate, money, shortDate } from "@/lib/format";
import {
  useActiveOrg,
  useApplications,
  useListing,
  useListingDistribution,
  useListingLeads,
  useProperties,
  useResyncChannel,
  useSetChannelEnabled,
  useUpdateApplicationStatus,
  useUpdateListing,
  useUpdateListingStatus,
} from "@/lib/rentid";
import type { ApplicationStatus } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/listings/$listingId")({
  head: () => ({
    meta: [{ title: "Listing distribution — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: ListingDistributionPage,
});

function ListingDistributionPage() {
  const { listingId } = useParams({ from: "/_authenticated/listings/$listingId" });
  const active = useActiveOrg();
  const listing = useListing(listingId);
  const distribution = useListingDistribution(listingId);
  const applications = useApplications(active.orgId);
  const leads = useListingLeads(active.orgId);
  const properties = useProperties(active.orgId);

  const setChannel = useSetChannelEnabled();
  const resync = useResyncChannel();
  const updateListing = useUpdateListing();
  const updateStatus = useUpdateListingStatus();
  const updateApplication = useUpdateApplicationStatus();

  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<ListingFormValues | null>(null);

  if (listing.isPending) {
    return (
      <AppShell>
        <div className="mt-4">
          <LoadingCard label="Loading listing…" rows={4} />
        </div>
      </AppShell>
    );
  }

  if (listing.isError || !listing.data) {
    return (
      <AppShell>
        <div className="mt-4">
          <InlineError message="Listing unavailable." onRetry={() => void listing.refetch()} />
        </div>
      </AppShell>
    );
  }

  const data = listing.data;
  const pipeline = data.pipeline;
  const listingApps = (applications.data ?? []).filter((a) => a.listing_id === data.id);
  const listingLeads = (leads.data ?? []).filter((l) => l.listing_id === data.id);
  const busy = setChannel.isPending || resync.isPending;

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!values) return;
    await updateListing.mutateAsync({
      listingId: data.id,
      patch: { ...listingCoreFromValues(values), ...listingDetailFromValues(values) },
    });
    setEditing(false);
  }

  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader
        title={data.headline}
        subtitle={`${data.property?.name ?? "Property"} · ${data.unit?.name ?? "Unit"}`}
        action={
          <div className="flex gap-2">
            <Button
              tone="secondary"
              size="sm"
              onClick={() => {
                setValues(valuesFromListing(data));
                setEditing(true);
              }}
            >
              Edit listing
            </Button>
            {data.status === "leased" ? (
              <Button
                size="sm"
                onClick={() =>
                  report(
                    updateStatus.mutateAsync({ listingId: data.id, status: "published" }),
                    "Could not relist.",
                  )
                }
              >
                Relist
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() =>
                  report(
                    updateStatus.mutateAsync({ listingId: data.id, status: "leased" }),
                    "Could not mark it rented.",
                  )
                }
              >
                Mark rented
              </Button>
            )}
          </div>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusPill
          status={data.status === "leased" ? "rented" : data.status}
          tone={
            data.status === "published"
              ? "success"
              : data.status === "leased"
                ? "accent"
                : "neutral"
          }
        />
        <Pill tone="accent">Listing ID {data.public_ref ?? data.id.slice(0, 8)}</Pill>
        <Pill>{money(data.monthly_rent)} / month</Pill>
        <Pill>Available {shortDate(data.available_on)}</Pill>
        {data.assigned_to ? <Pill>Assigned to {data.assigned_to}</Pill> : null}
      </div>

      <div className="mt-5">
        <SummaryGrid
          items={[
            { label: "Views", value: pipeline.views },
            { label: "Leads", value: pipeline.leads },
            { label: "Applications", value: `${pipeline.completed} / ${pipeline.started}` },
            { label: "Qualified", value: pipeline.qualified, tone: "success" },
          ]}
        />
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <SectionCard
          title="Listing distribution"
          aside="RentID is the source of truth"
          footer={
            <p className="text-[11.5px] text-muted-foreground">
              RentID only distributes through official partner APIs and approved listing feeds. No
              scraping, and no posting on your behalf into another company's account.
            </p>
          }
        >
          {distribution.isPending ? (
            <div className="p-4">
              <LoadingCard rows={3} />
            </div>
          ) : (
            (distribution.data?.channels ?? []).map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                busy={busy}
                onToggle={(enabled) =>
                  report(
                    setChannel.mutateAsync({
                      listingId: data.id,
                      marketplaceId: channel.marketplace_id,
                      enabled,
                    }),
                    "Could not update that channel.",
                  )
                }
                onResync={() =>
                  report(
                    resync.mutateAsync({
                      listingId: data.id,
                      marketplaceId: channel.marketplace_id,
                    }),
                    "Could not resync that channel.",
                  )
                }
              />
            ))
          )}
        </SectionCard>

        <div className="space-y-3">
          <SectionCard title="Public links" aside="Use these as the Apply Now target">
            <div className="space-y-2 px-4 py-3">
              <div>
                <Eyebrow>Listing page</Eyebrow>
                <p className="num mt-1 text-[12.5px] break-all">{publicListingUrl(data)}</p>
                <Link
                  to="/listing/$listingRef"
                  params={{ listingRef: data.public_ref ?? data.id }}
                  className="text-[11.5px] font-medium text-accent"
                >
                  Open public listing
                </Link>
              </div>
              <div>
                <Eyebrow>Application link</Eyebrow>
                <p className="num mt-1 text-[12.5px] break-all">{publicApplyUrl(data)}</p>
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  Every application submitted anywhere comes back into RentID with its source
                  attached.
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Sync history"
            aside={`${distribution.data?.events.length ?? 0} events`}
          >
            {(distribution.data?.events ?? []).length > 0 ? (
              (distribution.data?.events ?? [])
                .slice(0, 8)
                .map((event) => (
                  <ListRow
                    key={event.id}
                    title={`${event.action} · ${event.marketplace_id}`}
                    subtitle={event.message}
                    pill={
                      <StatusPill
                        status={event.result.replace("_", " ")}
                        tone={
                          event.result === "succeeded"
                            ? "success"
                            : event.result === "failed"
                              ? "danger"
                              : "warning"
                        }
                      />
                    }
                    value={fullDate(event.created_at)}
                  />
                ))
            ) : (
              <ListRow
                title="No sync activity yet"
                subtitle="Publishing a channel records an event"
              />
            )}
          </SectionCard>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <SectionCard title="Applicant pipeline" aside={`${listingApps.length} applicants`}>
          {listingApps.length > 0 ? (
            listingApps.map((application) => (
              <div key={application.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">
                      {application.applicant_name}
                    </p>
                    <p className="num mt-0.5 text-[11.5px] text-muted-foreground">
                      {SOURCE_LABELS[application.source ?? "rentid"]} ·{" "}
                      {money(application.monthly_income ?? 0)} income · applied{" "}
                      {shortDate(application.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill
                      status={applicationLabel(application.status)}
                      tone={applicationTone(application.status)}
                    />
                    <Select
                      className="w-auto py-1.5 text-[12px]"
                      value={application.status}
                      onChange={(e) =>
                        report(
                          updateApplication.mutateAsync({
                            applicationId: application.id,
                            status: e.target.value as ApplicationStatus,
                          }),
                          "Could not update the application.",
                        )
                      }
                    >
                      {APPLICATION_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <ListRow
              title="No applicants yet"
              subtitle="Applications land here from every channel"
            />
          )}
        </SectionCard>

        <SectionCard title="Leads" aside={`${listingLeads.length} total`}>
          {listingLeads.length > 0 ? (
            listingLeads.map((lead) => (
              <ListRow
                key={lead.id}
                title={lead.name ?? lead.email ?? "Anonymous enquiry"}
                subtitle={`${SOURCE_LABELS[lead.source]}${lead.utm_medium ? ` · ${lead.utm_medium}` : ""} · ${shortDate(lead.created_at)}`}
              />
            ))
          ) : (
            <ListRow title="No leads yet" subtitle="Every enquiry keeps its source and UTM tags" />
          )}
        </SectionCard>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit listing">
        {values ? (
          <ListingForm
            mode="edit"
            values={values}
            onChange={setValues}
            properties={properties.data ?? []}
            units={[]}
            submitting={updateListing.isPending}
            onSubmit={saveEdit}
            onCancel={() => setEditing(false)}
          />
        ) : null}
      </Modal>
    </AppShell>
  );
}

/**
 * These controls fire and forget. Without this, an RLS or validation failure is
 * swallowed and the button simply appears not to work.
 */
function report(p: Promise<unknown>, fallback: string) {
  p.catch((err) => toast.error(err instanceof Error ? err.message : fallback));
}
