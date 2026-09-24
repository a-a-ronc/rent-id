import { createFileRoute } from "@tanstack/react-router";

import { PublicGrid, PublicHero, PublicShell } from "@/components/rentid/PublicShell";

const TITLE = "RentID for tenants — rent, receipts and a rental record you own";
const DESCRIPTION =
  "Manage everything with your apartment through one app, while building credit and rental history. Rent paid through RentID becomes verified history: receipts you can show, lease at the ready, a rental profile you can share with your next landlord.";

export const Route = createFileRoute("/for-tenants")({
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
  component: ForTenants,
});

function ForTenants() {
  return (
    <PublicShell>
      <PublicHero
        eyebrow="For tenants"
        title={
          <>
            Your rent history should <span className="text-accent">work for you</span>.
          </>
        }
        body="Manage everything with your apartment through one app, while building credit and rental history. Rent paid through RentID becomes verified history: receipts you can show, lease at the ready, a rental profile you can share with your next landlord. Also, only on-time rent payments get reported to your credit score, to help protect and build credit outside RentID."
        primary={{ to: "/auth", label: "Create your RentID" }}
        secondary={{ to: "/rent", label: "Browse rentals" }}
      />

      <section className="pb-12">
        <h2 className="font-display text-[19px] font-semibold tracking-tight">How it works</h2>
        <div className="mt-4">
          <PublicGrid
            columns={3}
            items={[
              {
                title: "1. Verify who you are",
                body: "One identity per person, so your record can't be duplicated or claimed by someone else.",
              },
              {
                title: "2. Connect your tenancy",
                body: "Have your landlord confirm your rental details, or upload an executed lease to get started without your landlord.",
              },
              {
                title: "3. Build the record",
                body: "Every on-time payment, receipt and closed maintenance request is stored with its source.",
              },
            ]}
          />
        </div>
      </section>

      <section className="pb-12">
        <h2 className="font-display text-[19px] font-semibold tracking-tight">What you get</h2>
        <div className="mt-4">
          <PublicGrid
            items={[
              {
                title: "Receipts and payment history",
                body: "A dated ledger of what you paid and when, verified through RentID.",
              },
              {
                title: "Lease and document vault",
                body: "Your lease, addenda and notices in one place — not lost in an old email thread. Even request to sublease through RentID.",
              },
              {
                title: "Maintenance with evidence",
                body: "Report an issue with photos and keep the time stamped record of what was requested, and the time it took for it to be addressed.",
              },
              {
                title: "A shareable rental profile",
                body: "Share verified history with a new landlord instead of starting from zero.",
              },
            ]}
          />
        </div>
      </section>

      <section className="glass mb-4 rounded-2xl p-5">
        <h2 className="font-display text-[15px] font-semibold tracking-tight">
          You don't need your landlord to join first
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          You can pay rent to a landlord who isn't on RentID yet. We confirm the recipient is
          authorised to receive rent for that address before money moves. Live payments are being
          licensed and are not enabled yet.
        </p>
      </section>
    </PublicShell>
  );
}
