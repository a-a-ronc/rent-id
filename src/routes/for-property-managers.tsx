import { createFileRoute } from "@tanstack/react-router";

import { PublicGrid, PublicHero, PublicShell } from "@/components/rentid/PublicShell";

const TITLE = "RentID for property managers — owners, portfolios and proof of performance";
const DESCRIPTION =
  "Manage owner contracts and portfolio permissions, reconcile rent, hit maintenance SLAs and show owners a verified operating record.";

export const Route = createFileRoute("/for-property-managers")({
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
  component: ForPropertyManagers,
});

function ForPropertyManagers() {
  return (
    <PublicShell>
      <PublicHero
        eyebrow="For property managers"
        title={
          <>
            Manage other people's property with <span className="text-accent">proof</span>.
          </>
        }
        body="A separate product, not a landlord account with extra seats. Owner contracts, delegated authority per property, reconciliation, SLAs and an operating profile owners can verify before they sign."
        primary={{ to: "/auth", label: "Open the manager demo" }}
        secondary={{ to: "/for-landlords", label: "I own my properties" }}
      />

      <section className="pb-12">
        <h2 className="font-display text-[19px] font-semibold tracking-tight">
          Owners and authority
        </h2>
        <div className="mt-4">
          <PublicGrid
            items={[
              {
                title: "Owner accounts and contracts",
                body: "Management fee, contract start and the properties covered — recorded per owner.",
              },
              {
                title: "Delegated authority per property",
                body: "Authority is granted by the owner and stored separately from ownership, so an owner can change manager without losing history.",
              },
              {
                title: "Owner reporting",
                body: "What was collected, what was spent and what is outstanding, per owner and per property.",
              },
              {
                title: "Exceptions first",
                body: "Short payments, unreconciled items and overdue work orders surface before month end.",
              },
            ]}
          />
        </div>
      </section>

      <section className="pb-12">
        <h2 className="font-display text-[19px] font-semibold tracking-tight">Operations</h2>
        <div className="mt-4">
          <PublicGrid
            columns={3}
            items={[
              {
                title: "Leasing pipeline",
                body: "Listings, applicants and lease packets across every owner's portfolio.",
              },
              {
                title: "Maintenance SLAs",
                body: "First response and resolution targets tracked with the evidence attached.",
              },
              {
                title: "A manager profile",
                body: "Units managed, response times, collection rate and reviews — visible to owners and tenants.",
              },
            ]}
          />
        </div>
      </section>
    </PublicShell>
  );
}
