import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  AppShell,
  PageHeader,
  SectionCard,
  StatusPill,
  SummaryGrid,
} from "@/components/rentid/patterns";
import { Field, InlineError, LoadingCard, Select, TextInput } from "@/components/rentid/kit";
import { EmptyState, Eyebrow, Pill } from "@/components/rentid/Surface";
import { SOURCE_LABELS } from "@/components/rentid/listing-ui";
import { MARKETPLACE_ADAPTERS, marketplaceName } from "@/lib/syndication/adapters";
import { money, shortDate } from "@/lib/format";
import { useListingSources, useManagedListings, useManagementOrg } from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/manager/listings")({
  head: () => ({
    meta: [
      { title: "Leasing & distribution — RentID for property managers" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ManagerListingsPage,
});

function ManagerListingsPage() {
  const management = useManagementOrg();
  const orgId = management.orgId;
  const listings = useManagedListings(orgId);
  const listingIds = (listings.data ?? []).map((l) => l.id);
  const sources = useListingSources(orgId, listingIds);

  const [property, setProperty] = useState("all");
  const [owner, setOwner] = useState("all");
  const [status, setStatus] = useState("all");
  const [marketplace, setMarketplace] = useState("all");
  const [agent, setAgent] = useState("all");
  const [availableBy, setAvailableBy] = useState("");

  const rows = listings.data ?? [];

  const options = useMemo(() => {
    const uniq = (values: (string | null | undefined)[]) =>
      [...new Set(values.filter((v): v is string => Boolean(v)))].sort();
    return {
      properties: uniq(rows.map((l) => l.property?.name)),
      owners: uniq(rows.map((l) => l.owner_name)),
      agents: uniq(rows.map((l) => l.assigned_to)),
    };
  }, [rows]);

  const filtered = rows.filter((l) => {
    if (property !== "all" && l.property?.name !== property) return false;
    if (owner !== "all" && l.owner_name !== owner) return false;
    if (status !== "all" && l.status !== status) return false;
    if (agent !== "all" && l.assigned_to !== agent) return false;
    if (availableBy && l.available_on > availableBy) return false;
    if (marketplace !== "all") {
      const channel = l.channels.find((c) => c.marketplace_id === marketplace);
      if (!channel?.enabled) return false;
    }
    return true;
  });

  // Multifamily and student properties carry many listings; group by building.
  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const listing of filtered) {
      const key = listing.property?.name ?? "Unassigned property";
      map.set(key, [...(map.get(key) ?? []), listing]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <AppShell role="manager" subtitle="Property management">
      <PageHeader
        title="Leasing & distribution"
        subtitle={management.org?.name ?? "Managed portfolio"}
      />

      <div className="mt-5">
        <SummaryGrid
          items={[
            { label: "Listings", value: filtered.length },
            {
              label: "Published",
              value: filtered.filter((l) => l.status === "published").length,
              tone: "success",
            },
            { label: "Applications", value: filtered.reduce((s, l) => s + l.application_count, 0) },
            { label: "Leads", value: filtered.reduce((s, l) => s + l.pipeline.leads, 0) },
          ]}
        />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Property">
          <Select value={property} onChange={(e) => setProperty(e.target.value)}>
            <option value="all">All properties</option>
            {options.properties.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner">
          <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">All owners</option>
            {options.owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Any status</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="paused">Paused</option>
            <option value="leased">Rented</option>
          </Select>
        </Field>
        <Field label="Marketplace">
          <Select value={marketplace} onChange={(e) => setMarketplace(e.target.value)}>
            <option value="all">Any channel</option>
            {MARKETPLACE_ADAPTERS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Assigned employee">
          <Select value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="all">Anyone</option>
            {options.agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Available by">
          <TextInput
            type="date"
            value={availableBy}
            onChange={(e) => setAvailableBy(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-5 space-y-3">
        {listings.isPending ? (
          <LoadingCard rows={4} />
        ) : listings.isError ? (
          <InlineError message="Listings unavailable." onRetry={() => void listings.refetch()} />
        ) : grouped.length === 0 ? (
          <EmptyState
            title="No listings match these filters"
            description="Clear a filter, or create a listing from a vacant unit in the portfolio."
          />
        ) : (
          grouped.map(([propertyName, group]) => (
            <SectionCard
              key={propertyName}
              title={propertyName}
              aside={`${group.length} listing${group.length === 1 ? "" : "s"}`}
            >
              {group.map((listing) => (
                <div key={listing.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[13.5px] font-medium">
                          {listing.unit?.name ?? "Unit"} — {listing.headline}
                        </p>
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
                      </div>
                      <p className="num mt-0.5 text-[11.5px] text-muted-foreground">
                        {money(listing.monthly_rent)} · available {shortDate(listing.available_on)}
                        {listing.owner_name ? ` · owner ${listing.owner_name}` : ""}
                        {listing.assigned_to ? ` · ${listing.assigned_to}` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {listing.channels
                          .filter((c) => c.enabled)
                          .map((c) => (
                            <Pill
                              key={c.id}
                              tone={c.listing_status === "live" ? "accent" : "warning"}
                            >
                              {marketplaceName(c.marketplace_id)}
                              {c.listing_status === "live" ? " · live" : " · pending"}
                            </Pill>
                          ))}
                        <Pill>{listing.pipeline.leads} leads</Pill>
                        <Pill>{listing.application_count} applications</Pill>
                      </div>
                    </div>
                    <Link
                      to="/listings/$listingId"
                      params={{ listingId: listing.id }}
                      className="text-[11.5px] font-medium text-accent"
                    >
                      Manage
                    </Link>
                  </div>
                </div>
              ))}
            </SectionCard>
          ))
        )}
      </div>

      <div className="mt-5">
        <SectionCard title="Channel performance" aside="Leads and signed leases by source">
          {(sources.data ?? []).length > 0 ? (
            (sources.data ?? []).map((row) => (
              <div key={row.source} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-[13.5px] font-medium">{SOURCE_LABELS[row.source]}</p>
                  <Eyebrow className="mt-0.5">
                    {row.applications} applications · {row.signed} signed
                  </Eyebrow>
                </div>
                <span className="num text-[14px] font-medium">{row.leads}</span>
              </div>
            ))
          ) : (
            <div className="px-4 py-3 text-[12.5px] text-muted-foreground">
              Sources appear as leads arrive from each channel.
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
