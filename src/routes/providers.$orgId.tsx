import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ShieldCheck, Star } from "lucide-react";

import { PublicShell } from "@/components/rentid/PublicShell";
import { EmptyState, Eyebrow, Glass, Pill } from "@/components/rentid/Surface";
import { TrustBadge } from "@/components/rentid/TrustBadge";
import { InlineError, LoadingCard } from "@/components/rentid/kit";
import { shortDate } from "@/lib/format";
import { useProviderProfile } from "@/lib/rentid";

export const Route = createFileRoute("/providers/$orgId")({
  head: () => ({
    meta: [
      { title: "Verified landlord record — RentID" },
      {
        name: "description",
        content:
          "A RentID provider record: verified properties, response times, collection rate and reviews, each with its source.",
      },
      { property: "og:title", content: "Verified landlord record — RentID" },
      {
        property: "og:description",
        content:
          "Verified properties, response times and reviews — every label carries its source.",
      },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProviderProfilePage,
});

function ProviderProfilePage() {
  const { orgId } = useParams({ from: "/providers/$orgId" });
  const profile = useProviderProfile(orgId);

  if (profile.isPending) {
    return (
      <PublicShell>
        <div className="py-8">
          <LoadingCard label="Loading record…" rows={4} />
        </div>
      </PublicShell>
    );
  }

  if (profile.isError) {
    return (
      <PublicShell>
        <div className="py-8">
          <InlineError
            message="We couldn't load this record."
            onRetry={() => void profile.refetch()}
          />
        </div>
      </PublicShell>
    );
  }

  const data = profile.data;
  if (!data) {
    return (
      <PublicShell>
        <div className="py-8">
          <EmptyState
            title="Record not found"
            description="This landlord or manager doesn't have a public RentID record."
            action={
              <Link to="/rent" className="text-[13px] font-medium text-accent">
                Browse rentals
              </Link>
            }
          />
        </div>
      </PublicShell>
    );
  }

  const stats: [string, string | number][] = [
    ["Verified properties", data.verified_properties],
    ["Verified units", data.verified_units],
    ["Median first response", `${data.median_first_response_hours} h`],
    ["Resolved under 72h", `${data.resolved_under_72h_pct}%`],
    ["Rent collected on time", `${data.collection_rate_pct}%`],
    [data.kind === "property_manager" ? "Owners served" : "Portfolios", data.owners_served],
  ];

  return (
    <PublicShell>
      <div className="py-6">
        <Glass className="p-6">
          <Eyebrow>{data.kind === "property_manager" ? "Property manager" : "Landlord"}</Eyebrow>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[28px] leading-tight font-bold tracking-tight">
              {data.name}
            </h1>
            {data.verification_status === "verified" ? (
              <TrustBadge kind="platform_verified" />
            ) : (
              <TrustBadge kind="unverified" />
            )}
            {data.open_disputes > 0 ? <TrustBadge kind="under_dispute" /> : null}
          </div>
          <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
            Every number below comes from a verified relationship or a recorded event in RentID. No
            scores, no estimates.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {data.tenant_rating != null ? (
              <Pill tone="accent">
                <Star className="size-3" strokeWidth={2} />
                {data.tenant_rating} from tenants
              </Pill>
            ) : (
              <Pill>No tenant reviews yet</Pill>
            )}
            {data.owner_rating != null ? (
              <Pill tone="accent">{data.owner_rating} from owners</Pill>
            ) : null}
            <Pill tone="success">
              <ShieldCheck className="size-3" strokeWidth={2} />
              Identity and ownership checked
            </Pill>
          </div>
        </Glass>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map(([label, value]) => (
            <Glass key={label} className="p-4">
              <Eyebrow>{label}</Eyebrow>
              <p className="num mt-2 text-[22px] leading-none font-medium">{value}</p>
            </Glass>
          ))}
        </div>

        <section className="mt-4">
          <Glass className="overflow-hidden">
            <div className="border-b border-border/60 px-5 py-3">
              <h2 className="font-display text-[15px] font-semibold tracking-tight">
                Reviews from verified tenancies
              </h2>
            </div>
            {data.reviews.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-muted-foreground">
                No published reviews yet. Reviews only exist after a verified tenancy ends.
              </p>
            ) : (
              <ul className="divide-y divide-border/50">
                {data.reviews.map((review) => (
                  <li key={review.id} className="px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[13.5px] font-medium">{review.author_name}</p>
                      <span className="num text-[12.5px] text-muted-foreground">
                        {review.rating}/5 · {shortDate(review.created_at)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                      {review.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Glass>
        </section>
      </div>
    </PublicShell>
  );
}
