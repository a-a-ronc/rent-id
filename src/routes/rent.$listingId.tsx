import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Check, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { PublicShell } from "@/components/rentid/PublicShell";
import { EmptyState, Eyebrow, Glass, Pill } from "@/components/rentid/Surface";
import {
  Button,
  Field,
  FormGrid,
  InlineError,
  LoadingCard,
  TextArea,
  TextInput,
} from "@/components/rentid/kit";
import { money, shortDate } from "@/lib/format";
import { useApplyToListing, useListing } from "@/lib/rentid";

export const Route = createFileRoute("/rent/$listingId")({
  head: () => ({
    meta: [
      { title: "Rental listing — RentID" },
      {
        name: "description",
        content:
          "A verified RentID rental listing: rent, lease term, amenities, screening criteria and the landlord's operating record.",
      },
      { property: "og:title", content: "Rental listing — RentID" },
      {
        property: "og:description",
        content: "Verified rent, lease terms and landlord record — apply with your RentID profile.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ListingDetail,
});

function ListingDetail() {
  const { listingId } = useParams({ from: "/rent/$listingId" });
  const listing = useListing(listingId);
  const apply = useApplyToListing();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [income, setIncome] = useState("");
  const [moveIn, setMoveIn] = useState("");
  const [note, setNote] = useState("");
  const [share, setShare] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!listing.data) return;
    await apply.mutateAsync({
      listingId: listing.data.id,
      applicantName: name,
      applicantEmail: email,
      applicantPhone: phone || null,
      monthlyIncome: income ? Number(income) : null,
      moveInDate: moveIn || null,
      note: note || null,
      shareProfile: share,
    });
    setSubmitted(true);
  }

  if (listing.isPending) {
    return (
      <PublicShell>
        <div className="py-8">
          <LoadingCard label="Loading listing…" rows={4} />
        </div>
      </PublicShell>
    );
  }

  if (listing.isError) {
    return (
      <PublicShell>
        <div className="py-8">
          <InlineError
            message="We couldn't load this listing."
            onRetry={() => void listing.refetch()}
          />
        </div>
      </PublicShell>
    );
  }

  const data = listing.data;
  if (!data) {
    return (
      <PublicShell>
        <div className="py-8">
          <EmptyState
            title="Listing unavailable"
            description="This rental is no longer published. Browse the other verified listings."
            action={
              <Link to="/rent" className="text-[13px] font-medium text-accent">
                Back to rentals
              </Link>
            }
          />
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <div className="py-6">
        <Link
          to="/rent"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} />
          All rentals
        </Link>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <Glass className="p-5">
              <Eyebrow>
                {data.property
                  ? `${data.property.city}, ${data.property.state}`
                  : "Location on request"}
              </Eyebrow>
              <h1 className="mt-2 font-display text-[26px] leading-tight font-bold tracking-tight">
                {data.headline}
              </h1>
              <p className="num mt-3 text-[22px] font-medium">
                {money(data.monthly_rent)}
                <span className="text-[13px] text-muted-foreground"> / month</span>
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Pill tone="success">
                  <ShieldCheck className="size-3" strokeWidth={2} />
                  Verified property
                </Pill>
                <Pill>Available {shortDate(data.available_on)}</Pill>
                <Pill tone="accent">{data.lease_term_months} month lease</Pill>
                {data.security_deposit ? <Pill>Deposit {money(data.security_deposit)}</Pill> : null}
              </div>
              {data.description ? (
                <p className="mt-4 text-[13.5px] leading-relaxed text-muted-foreground">
                  {data.description}
                </p>
              ) : null}

              <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Bedrooms", data.unit?.bedrooms ?? "—"],
                  ["Bathrooms", data.unit?.bathrooms ?? "—"],
                  ["Size", data.unit?.square_feet ? `${data.unit.square_feet} sq ft` : "—"],
                  ["Unit", data.unit?.name ?? "—"],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl bg-secondary/60 px-3 py-2.5">
                    <dt className="label-eyebrow">{label}</dt>
                    <dd className="num mt-1 text-[13.5px] font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </Glass>

            {data.amenities.length > 0 ? (
              <Glass className="p-5">
                <h2 className="font-display text-[15px] font-semibold tracking-tight">Amenities</h2>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {data.amenities.map((amenity) => (
                    <li
                      key={amenity}
                      className="flex items-center gap-2 text-[13px] text-muted-foreground"
                    >
                      <Check className="size-3.5 text-success" strokeWidth={2.5} />
                      {amenity}
                    </li>
                  ))}
                </ul>
              </Glass>
            ) : null}

            {data.screening_criteria ? (
              <Glass className="p-5">
                <h2 className="font-display text-[15px] font-semibold tracking-tight">
                  Screening criteria
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  {data.screening_criteria}
                </p>
              </Glass>
            ) : null}

            {data.provider ? (
              <Glass className="p-5">
                <Eyebrow>
                  {data.provider.kind === "property_manager" ? "Managed by" : "Listed by"}
                </Eyebrow>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-[16px] font-semibold tracking-tight">
                    {data.provider.name}
                  </h2>
                  <Link
                    to="/providers/$orgId"
                    params={{ orgId: data.provider.organization_id }}
                    className="text-[12.5px] font-medium text-accent"
                  >
                    View record
                  </Link>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Verified units", data.provider.verified_units],
                    ["Median response", `${data.provider.median_first_response_hours} h`],
                    ["Resolved < 72h", `${data.provider.resolved_under_72h_pct}%`],
                    ["Tenant rating", data.provider.tenant_rating ?? "No reviews yet"],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl bg-secondary/60 px-3 py-2.5">
                      <p className="label-eyebrow">{label}</p>
                      <p className="num mt-1 text-[13.5px] font-medium">{value}</p>
                    </div>
                  ))}
                </div>
              </Glass>
            ) : null}
          </div>

          <Glass className="h-fit p-5 lg:sticky lg:top-6">
            {submitted ? (
              <div>
                <Pill tone="success">
                  <Check className="size-3" strokeWidth={2.5} />
                  Application sent
                </Pill>
                <h2 className="mt-3 font-display text-[16px] font-semibold tracking-tight">
                  You're in the queue
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  {data.provider?.name ?? "The landlord"} can now see your application
                  {share ? " and the verified history you shared" : ""}. Create a RentID to track
                  the decision and reuse this application.
                </p>
                <Link
                  to="/auth"
                  className="mt-4 inline-flex rounded-full bg-brand px-5 py-2.5 text-[13px] font-semibold text-brand-foreground"
                >
                  Create your RentID
                </Link>
              </div>
            ) : (
              <form onSubmit={submit}>
                <h2 className="font-display text-[16px] font-semibold tracking-tight">
                  Apply for this rental
                </h2>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  One application, shared with your consent.
                </p>
                <FormGrid className="mt-4">
                  <Field label="Full name">
                    <TextInput required value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field label="Email">
                    <TextInput
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                  <Field label="Phone">
                    <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </Field>
                  <Field label="Monthly income">
                    <TextInput
                      type="number"
                      inputMode="numeric"
                      value={income}
                      onChange={(e) => setIncome(e.target.value)}
                    />
                  </Field>
                  <Field label="Move-in date">
                    <TextInput
                      type="date"
                      value={moveIn}
                      onChange={(e) => setMoveIn(e.target.value)}
                    />
                  </Field>
                  <Field label="Anything else?">
                    <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                </FormGrid>

                <label className="mt-4 flex items-start gap-2.5 text-[12.5px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={share}
                    onChange={(e) => setShare(e.target.checked)}
                    className="mt-0.5 size-4 accent-[oklch(var(--accent))]"
                  />
                  Share my verified RentID rental history with this landlord.
                </label>

                {apply.isError ? (
                  <p className="mt-3 text-[12px] text-destructive">
                    We couldn't submit that. Please try again.
                  </p>
                ) : null}

                <Button type="submit" className="mt-4 w-full" disabled={apply.isPending}>
                  {apply.isPending ? "Sending…" : "Submit application"}
                </Button>
              </form>
            )}
          </Glass>
        </div>
      </div>
    </PublicShell>
  );
}
