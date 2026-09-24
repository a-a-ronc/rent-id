import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { BadgeCheck, MapPin, ShieldCheck } from "lucide-react";
import { useEffect } from "react";

import { PublicShell } from "@/components/rentid/PublicShell";
import { EmptyState, Eyebrow, Glass, Pill } from "@/components/rentid/Surface";
import { Button, LoadingCard } from "@/components/rentid/kit";
import { money, fullDate } from "@/lib/format";
import { recordListingView } from "@/lib/services/syndication";
import { useListingByRef, usePropertyVerification } from "@/lib/rentid";
import {
  OwnershipNotice,
  PropertyVerificationBadgeButton,
} from "@/components/rentid/verification-ui";

export const Route = createFileRoute("/listing/$listingRef")({
  head: () => ({
    meta: [
      { title: "Rental listing — RentID" },
      {
        name: "description",
        content:
          "A RentID rental listing: rent, deposit, availability, amenities, pet and parking policy, application requirements and how to apply with your verified rental history.",
      },
      { property: "og:title", content: "Rental listing — RentID" },
      {
        property: "og:description",
        content:
          "See the full rental details and apply through RentID with your verified rental history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PublicListing,
});

function PublicListing() {
  const { listingRef } = useParams({ from: "/listing/$listingRef" });
  const listing = useListingByRef(listingRef);
  const verification = usePropertyVerification(listing.data?.property_id ?? null);
  const id = listing.data?.id;

  useEffect(() => {
    if (id) recordListingView(id);
  }, [id]);

  if (listing.isPending) {
    return (
      <PublicShell>
        <div className="py-8">
          <LoadingCard label="Loading listing…" rows={4} />
        </div>
      </PublicShell>
    );
  }

  if (!listing.data) {
    return (
      <PublicShell>
        <div className="py-8">
          <EmptyState
            title="Listing not found"
            description="This listing may have been rented or taken down."
            action={
              <Link to="/rent">
                <Button>Browse rentals</Button>
              </Link>
            }
          />
        </div>
      </PublicShell>
    );
  }

  const l = listing.data;
  const facts: [string, string][] = [
    ["Monthly rent", money(l.monthly_rent)],
    ["Security deposit", l.security_deposit ? money(l.security_deposit) : "—"],
    ["Available", fullDate(l.available_on)],
    ["Lease length", `${l.lease_term_months} months`],
    ["Bedrooms", l.bedrooms ? String(l.bedrooms) : "—"],
    ["Bathrooms", l.bathrooms ? String(l.bathrooms) : "—"],
    ["Square footage", l.square_feet ? `${l.square_feet} sq ft` : "—"],
    ["Occupancy limit", l.occupancy_limit ? `${l.occupancy_limit} people` : "—"],
  ];

  const policies: [string, string | null | undefined][] = [
    ["Utilities included", (l.utilities_included ?? []).join(", ") || null],
    ["Pets", l.pet_policy],
    ["Parking", l.parking],
    ["Move-in fees", l.move_in_fees],
    ["Application fee", l.application_fee ? money(l.application_fee) : null],
    ["Income requirement", l.income_requirement],
    ["Credit requirement", l.credit_requirement],
    ["Showing instructions", l.showing_instructions],
  ];

  return (
    <PublicShell>
      <div className="py-6">
        <Eyebrow>RentID listing {l.public_ref ?? ""}</Eyebrow>
        <h1 className="mt-2 font-display text-[26px] leading-tight font-bold tracking-tight sm:text-[32px]">
          {l.headline}
        </h1>
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <MapPin className="size-3.5" />
          {l.street_address ??
            `${l.property?.street_address ?? ""} ${l.property?.city ?? ""} ${l.property?.state ?? ""}`.trim()}
          {l.unit?.name ? ` · ${l.unit.name}` : ""}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <PropertyVerificationBadgeButton verification={verification.data} />
          {l.provider?.verification_status === "verified" ? (
            <Pill tone="success">
              <ShieldCheck className="size-3" /> Platform verified provider
            </Pill>
          ) : null}
          <Pill tone="accent">{money(l.monthly_rent)} / month</Pill>
          <Pill>Available {fullDate(l.available_on)}</Pill>
        </div>

        {verification.data && !verification.data.badge ? (
          <div className="mt-3">
            <OwnershipNotice />
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            to="/apply/$listingRef"
            params={{ listingRef: l.public_ref ?? l.id }}
            search={{ source: "rentid", utm_source: null, utm_campaign: null, utm_medium: null }}
          >
            <Button>Apply for this property</Button>
          </Link>
          {l.provider ? (
            <Link to="/providers/$orgId" params={{ orgId: l.organization_id }}>
              <Button tone="secondary">See the landlord's record</Button>
            </Link>
          ) : null}
        </div>

        {(l.photos ?? []).length > 0 ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {(l.photos ?? []).slice(0, 4).map((src) => (
              <img
                key={src}
                src={src}
                alt={`${l.headline} photo`}
                loading="lazy"
                className="h-48 w-full rounded-2xl object-cover"
              />
            ))}
          </div>
        ) : null}

        {l.description ? (
          <Glass className="mt-5 p-4">
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">{l.description}</p>
          </Glass>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Glass className="p-4">
            <Eyebrow>The home</Eyebrow>
            <dl className="mt-2 grid grid-cols-2 gap-3">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] text-muted-foreground">{label}</dt>
                  <dd className="num text-[13.5px] font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </Glass>

          <Glass className="p-4">
            <Eyebrow>Terms & policies</Eyebrow>
            <dl className="mt-2 space-y-2.5">
              {policies
                .filter(([, value]) => Boolean(value))
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] text-muted-foreground">{label}</dt>
                    <dd className="text-[13px]">{value}</dd>
                  </div>
                ))}
            </dl>
          </Glass>
        </div>

        {l.amenities.length > 0 ? (
          <div className="mt-5">
            <Eyebrow>Amenities</Eyebrow>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {l.amenities.map((a) => (
                <Pill key={a}>{a}</Pill>
              ))}
            </div>
          </div>
        ) : null}

        {(l.application_requirements ?? []).length > 0 ? (
          <div className="mt-5">
            <Eyebrow>What you need to apply</Eyebrow>
            <ul className="mt-2 space-y-1.5">
              {(l.application_requirements ?? []).map((req) => (
                <li key={req} className="flex items-start gap-2 text-[13px]">
                  <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-accent" />
                  {req}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Glass className="mt-6 p-4">
          <p className="text-[13.5px] font-medium">Apply once, use it everywhere</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            If you already have a RentID account, your rental resume fills in most of the
            application — verified rent payments, past addresses, landlord history and income.
          </p>
          <div className="mt-3">
            <Link
              to="/apply/$listingRef"
              params={{ listingRef: l.public_ref ?? l.id }}
              search={{ source: "rentid", utm_source: null, utm_campaign: null, utm_medium: null }}
            >
              <Button>Apply for this property</Button>
            </Link>
          </div>
        </Glass>
      </div>
    </PublicShell>
  );
}
