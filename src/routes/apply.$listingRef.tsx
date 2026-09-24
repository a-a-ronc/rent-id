import { createFileRoute, Link, useParams, useSearch } from "@tanstack/react-router";
import { Check, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PublicShell } from "@/components/rentid/PublicShell";
import { EmptyState, Eyebrow, Glass, Pill } from "@/components/rentid/Surface";
import { Button, Field, FormGrid, LoadingCard, TextArea, TextInput } from "@/components/rentid/kit";
import { SOURCE_LABELS } from "@/components/rentid/listing-ui";
import { useAuth, useProfile } from "@/lib/auth";
import { money, fullDate } from "@/lib/format";
import { useApplyToListing, useListingByRef, useRecordLead, useTenantPassport } from "@/lib/rentid";
import { OwnershipNotice, useTrustGate } from "@/components/rentid/verification-ui";
import type { LeadSource } from "@/lib/types";

type ApplySearch = {
  source: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  utm_medium: string | null;
};

export const Route = createFileRoute("/apply/$listingRef")({
  validateSearch: (search: Record<string, unknown>): ApplySearch => {
    const str = (key: string) => (typeof search[key] === "string" ? (search[key] as string) : null);
    return {
      source: str("source"),
      utm_source: str("utm_source"),
      utm_campaign: str("utm_campaign"),
      utm_medium: str("utm_medium"),
    };
  },
  head: () => ({
    meta: [
      { title: "Apply for this rental — RentID" },
      {
        name: "description",
        content:
          "Apply through RentID with your rental resume: verified rent payments, past addresses, landlord history and income, without retyping it for every property.",
      },
      { property: "og:title", content: "Apply for this rental — RentID" },
      {
        property: "og:description",
        content: "One RentID application carries your verified rental history to every landlord.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ApplyPage,
});

const SOURCES: LeadSource[] = [
  "rentid",
  "zillow",
  "apartments_com",
  "direct_link",
  "qr_code",
  "facebook",
  "other",
];

function ApplyPage() {
  const { listingRef } = useParams({ from: "/apply/$listingRef" });
  const search = useSearch({ from: "/apply/$listingRef" });
  const listing = useListingByRef(listingRef);
  const { user } = useAuth();
  const profile = useProfile();
  const passport = useTenantPassport({ userId: user?.id ?? null, email: user?.email ?? null });
  const apply = useApplyToListing();
  const recordLead = useRecordLead();
  const trust = useTrustGate(listing.data?.property_id ?? null, "application");

  const rawSource = search.source ?? "";
  const source: LeadSource = (SOURCES as string[]).includes(rawSource)
    ? (rawSource as LeadSource)
    : rawSource
      ? "other"
      : "direct_link";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [income, setIncome] = useState("");
  const [employer, setEmployer] = useState("");
  const [currentAddress, setCurrentAddress] = useState("");
  const [references, setReferences] = useState("");
  const [moveIn, setMoveIn] = useState("");
  const [note, setNote] = useState("");
  const [share, setShare] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  // Prefill from the applicant's RentID rental resume — only the gaps are asked for.
  const prefilled = Boolean(user);
  useEffect(() => {
    if (!user) return;
    setName((v) => v || profile.data?.full_name || "");
    setEmail((v) => v || user.email || "");
    setPhone((v) => v || profile.data?.phone || "");
  }, [user, profile.data]);

  // Every arrival is a lead, with its source and campaign tags kept.
  const listingId = listing.data?.id;
  useEffect(() => {
    if (!listingId) return;
    // Telemetry, not the applicant's problem: a failed lead write must never
    // surface to them, and must not become an unhandled rejection either.
    recordLead
      .mutateAsync({
        listingId,
        source,
        utmSource: search.utm_source ?? null,
        utmMedium: search.utm_medium ?? null,
        utmCampaign: search.utm_campaign ?? null,
        referrer: typeof document === "undefined" ? null : document.referrer || null,
        ...(user?.email ? { email: user.email } : {}),
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!listing.data) return;
    // A property with no verified ownership chain requires the one-time
    // disclosure before the application is sent.
    trust.guard(() => {
      send().catch((err) =>
        toast.error(
          err instanceof Error
            ? err.message
            : "Your application could not be sent. Please try again.",
        ),
      );
    });
  }

  async function send() {
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
      source,
      utmSource: search.utm_source ?? null,
      utmCampaign: search.utm_campaign ?? null,
      referrer: typeof document === "undefined" ? null : document.referrer || null,
      prefilledFromResume: prefilled && share,
      employer: employer || null,
      currentAddress: currentAddress || null,
      references: references || null,
    });
    setSubmitted(true);
  }

  if (listing.isPending) {
    return (
      <PublicShell>
        <div className="py-8">
          <LoadingCard label="Loading application…" rows={4} />
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
            description="This property may already be rented."
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

  if (submitted) {
    return (
      <PublicShell>
        <div className="py-10">
          <Glass className="p-6 text-center">
            <Check className="mx-auto size-8 text-success" />
            <h1 className="mt-3 font-display text-[22px] font-bold">Application submitted</h1>
            <p className="mx-auto mt-2 max-w-md text-[13.5px] text-muted-foreground">
              {l.headline} — the landlord received your application inside RentID, along with the
              rental history you chose to share. You can reuse this application for other homes.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Link to="/rent">
                <Button tone="secondary">Browse more rentals</Button>
              </Link>
              <Link to="/tenant/profile">
                <Button>Open my rental profile</Button>
              </Link>
            </div>
          </Glass>
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <div className="py-6">
        <Eyebrow>Apply through RentID</Eyebrow>
        <h1 className="mt-2 font-display text-[24px] leading-tight font-bold tracking-tight sm:text-[30px]">
          Apply for this property
        </h1>
        <p className="mt-2 text-[13.5px] text-muted-foreground">
          {l.headline} · {money(l.monthly_rent)} / month · available {fullDate(l.available_on)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill tone="accent">Listing {l.public_ref ?? l.id.slice(0, 8)}</Pill>
          <Pill>Came from {SOURCE_LABELS[source]}</Pill>
          <Link
            to="/listing/$listingRef"
            params={{ listingRef: l.public_ref ?? l.id }}
            className="text-[11.5px] font-medium text-accent"
          >
            See the full listing
          </Link>
        </div>

        {prefilled ? (
          <Glass className="mt-5 p-4">
            <p className="flex items-center gap-2 text-[13.5px] font-medium">
              <ShieldCheck className="size-4 text-accent" /> Filled in from your RentID rental
              resume
            </p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {passport.data
                ? `${passport.data.verified_tenancies} verified tenancies · ${passport.data.verified_payments} verified payments · ${passport.data.on_time_pct}% on time.`
                : "Your contact details were carried over. Only the missing pieces are asked for below."}
            </p>
          </Glass>
        ) : (
          <Glass className="mt-5 p-4">
            <p className="text-[13.5px] font-medium">Have a RentID account?</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Sign in first and your rental resume fills most of this in — then apply to other homes
              without typing it again.
            </p>
            <div className="mt-3">
              <Link to="/auth">
                <Button tone="secondary">Sign in to autofill</Button>
              </Link>
            </div>
          </Glass>
        )}

        <form onSubmit={submit} className="mt-5">
          <FormGrid>
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
            <Field
              label="Monthly income"
              {...(l.income_requirement ? { hint: l.income_requirement } : {})}
            >
              <TextInput
                type="number"
                inputMode="numeric"
                value={income}
                onChange={(e) => setIncome(e.target.value)}
              />
            </Field>
            <Field label="Employer">
              <TextInput value={employer} onChange={(e) => setEmployer(e.target.value)} />
            </Field>
            <Field label="Requested move-in">
              <TextInput type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} />
            </Field>
            <Field label="Current address" className="sm:col-span-2">
              <TextInput
                value={currentAddress}
                onChange={(e) => setCurrentAddress(e.target.value)}
              />
            </Field>
            <Field
              label="References"
              hint="Previous landlord name and contact"
              className="sm:col-span-2"
            >
              <TextInput value={references} onChange={(e) => setReferences(e.target.value)} />
            </Field>
            <Field label="Anything the landlord should know" className="sm:col-span-2">
              <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </FormGrid>

          <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-2xl border border-border/70 px-3.5 py-3">
            <input
              type="checkbox"
              checked={share}
              onChange={() => setShare(!share)}
              className="mt-0.5 size-4 accent-[var(--brand)]"
            />
            <span className="text-[12.5px] text-muted-foreground">
              Share my RentID rental history with this landlord — verified rent payments, tenancies
              and landlord reviews. You can decline; nothing is shared without this consent.
            </span>
          </label>

          {trust.notice ? (
            <div className="mt-4 rounded-2xl border border-border/70 px-3.5 py-3">
              <OwnershipNotice />
            </div>
          ) : null}

          <div className="mt-5 flex justify-end">
            <Button type="submit" loading={apply.isPending} disabled={apply.isPending}>
              Submit application
            </Button>
          </div>
        </form>
        {trust.dialog}
      </div>
    </PublicShell>
  );
}
