import { createFileRoute, Link } from "@tanstack/react-router";
import { BedDouble, MapPin, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { PublicShell } from "@/components/rentid/PublicShell";
import { EmptyState, Eyebrow, Glass, Pill } from "@/components/rentid/Surface";
import { InlineError, LoadingCard, Select, TextInput } from "@/components/rentid/kit";
import { money, shortDate } from "@/lib/format";
import { usePublicListings } from "@/lib/rentid";

const TITLE = "Find a rental on RentID — verified listings from verified landlords";
const DESCRIPTION =
  "Browse rentals where the property, the landlord and the lease terms are verified before the listing goes live.";

export const Route = createFileRoute("/rent/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RentSearch,
});

function RentSearch() {
  const [query, setQuery] = useState("");
  const [maxRent, setMaxRent] = useState("");
  const [minBeds, setMinBeds] = useState("");

  const listings = usePublicListings({
    query,
    maxRent: maxRent ? Number(maxRent) : null,
    minBeds: minBeds ? Number(minBeds) : null,
  });

  return (
    <PublicShell>
      <section className="pt-4 pb-8">
        <Eyebrow>Marketplace</Eyebrow>
        <h1 className="mt-2 max-w-2xl font-display text-[32px] leading-tight font-bold tracking-tight sm:text-[40px]">
          Rentals with a <span className="text-accent">verified</span> paper trail.
        </h1>
        <p className="mt-4 max-w-xl text-[14.5px] leading-relaxed text-muted-foreground">
          Every listing here is tied to a verified property and an authorised landlord or manager.
          Apply once with your RentID profile instead of retyping your history.
        </p>

        <Glass className="mt-6 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by city, property or unit"
              aria-label="Search listings"
            />
            <Select
              value={minBeds}
              onChange={(e) => setMinBeds(e.target.value)}
              aria-label="Minimum bedrooms"
            >
              <option value="">Any beds</option>
              <option value="1">1+ beds</option>
              <option value="2">2+ beds</option>
              <option value="3">3+ beds</option>
            </Select>
            <Select
              value={maxRent}
              onChange={(e) => setMaxRent(e.target.value)}
              aria-label="Maximum rent"
            >
              <option value="">Any rent</option>
              <option value="1200">Up to $1,200</option>
              <option value="1600">Up to $1,600</option>
              <option value="2200">Up to $2,200</option>
            </Select>
          </div>
        </Glass>
      </section>

      <section className="pb-10">
        {listings.isPending ? (
          <LoadingCard label="Loading listings…" rows={4} />
        ) : listings.isError ? (
          <InlineError
            message="We couldn't load listings."
            onRetry={() => void listings.refetch()}
          />
        ) : listings.data && listings.data.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {listings.data.map((listing, i) => (
              <Link key={listing.id} to="/rent/$listingId" params={{ listingId: listing.id }}>
                <Glass
                  className="h-full p-5 transition-colors hover:bg-secondary/40"
                  delay={i * 60}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-display text-[15px] leading-snug font-semibold tracking-tight">
                      {listing.headline}
                    </h2>
                    <p className="num shrink-0 text-[15px] font-medium">
                      {money(listing.monthly_rent)}
                    </p>
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <MapPin className="size-3.5" strokeWidth={1.75} />
                    {listing.property
                      ? `${listing.property.name} · ${listing.property.city}, ${listing.property.state}`
                      : "Address on request"}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <BedDouble className="size-3.5" strokeWidth={1.75} />
                    {listing.unit?.bedrooms ?? "—"} bd · {listing.unit?.bathrooms ?? "—"} ba ·{" "}
                    {listing.unit?.square_feet
                      ? `${listing.unit.square_feet} sq ft`
                      : "size on request"}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Pill tone="success">
                      <ShieldCheck className="size-3" strokeWidth={2} />
                      Verified{" "}
                      {listing.provider?.kind === "property_manager" ? "manager" : "landlord"}
                    </Pill>
                    <Pill>Available {shortDate(listing.available_on)}</Pill>
                    <Pill tone="accent">{listing.lease_term_months} mo lease</Pill>
                  </div>
                </Glass>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No matching rentals"
            description="Try a wider rent range or clear the search to see every published listing."
          />
        )}
      </section>
    </PublicShell>
  );
}
