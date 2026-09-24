import { createFileRoute } from "@tanstack/react-router";

import { PublicGrid, PublicHero, PublicShell } from "@/components/rentid/PublicShell";

const TITLE = "RentID for landlords — simplify your portfolio, maximize your potential";
const DESCRIPTION =
  "Every property, every unit, neatly organized and monitored for free. Easily manage your entire portfolio, even from your phone.";

export const Route = createFileRoute("/for-landlords")({
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
  component: ForLandlords,
});

function ForLandlords() {
  return (
    <PublicShell>
      <PublicHero
        eyebrow="For landlords"
        title={
          <>
            Simplify your portfolio, maximize your potential. Rent through{" "}
            <span className="text-accent">RentID</span>
          </>
        }
        body="Every property, every unit, neatly organized and monitored for free. Easily manage your entire portfolio, even from your phone."
        primary={{ to: "/auth", label: "Start with a demo portfolio" }}
        secondary={{ to: "/for-property-managers", label: "I manage for owners" }}
      />

      <section className="pb-12">
        <h2 className="font-display text-[19px] font-semibold tracking-tight">
          Run your Portfolio
        </h2>
        <div className="mt-4">
          <PublicGrid
            items={[
              {
                title: "Properties, units and leases",
                body: "Occupancy, rent, deposits and lease dates per unit, with documents attached where they belong.",
              },
              {
                title: "Rent ledger that balances",
                body: "Collected, outstanding, late and upcoming rent for the month — per tenancy, per period.",
              },
              {
                title: "Listings and applications",
                body: "Publish a vacancy through RentID, and RentID will publish your listing to other the major sites. Then applications come back through RentID, so you can receive applicants with verified rental history and income and make your decision, all in one place.",
              },
              {
                title: "Maintenance and evidence",
                body: "Work orders with priority, response time and a closing record. Before and after pictures and proofs, all recorded and organized for you to point to later.",
              },
            ]}
          />
        </div>
      </section>

      <section className="pb-12">
        <h2 className="font-display text-[19px] font-semibold tracking-tight">
          Verification, not vibes
        </h2>
        <div className="mt-4">
          <PublicGrid
            columns={3}
            items={[
              {
                title: "Claim your property",
                body: "Ownership is verified through identification to avoid scams or fraudulent activity",
              },
              {
                title: "Confirm the tenancy",
                body: "For properties you have claimed, both sides confirm the lease. Reputation only builds on verified tenancies.",
              },
              {
                title: "Show your record",
                body: "Response times, collection rate and reviews — every label carries its source.",
              },
            ]}
          />
        </div>
      </section>
    </PublicShell>
  );
}
