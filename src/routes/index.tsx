import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, Building2, ShieldCheck, Wallet } from "lucide-react";

import { PublicShell } from "@/components/rentid/PublicShell";
import { Eyebrow } from "@/components/rentid/Surface";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RentID — Verified renters, landlords and rentals" },
      {
        name: "description",
        content:
          "RentID gives renters, landlords and property managers one verified rental record: tenancies, leases, rent history and reviews in a single trusted place.",
      },
      { property: "og:title", content: "RentID — Verified renters, landlords and rentals" },
      {
        property: "og:description",
        content:
          "One verified rental record: tenancies, leases, rent history and two-way reviews — plus a marketplace of verified listings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: BadgeCheck,
    title: "Verified tenancies",
    body: "Upload your lease, verify your identity, and start building your RentID.",
  },
  {
    icon: Building2,
    title: "Portfolio clarity",
    body: "Properties, units, leases, documents, maintenance requests, and deductions all organized in a simple way to manage.",
  },
  {
    icon: Wallet,
    title: "Rent that reconciles",
    body: "Collected, outstanding and upcoming rent tracked per unit, per month, per lease term.",
  },
  {
    icon: ShieldCheck,
    title: "Two-way reputation",
    body: "Tenants review landlords. Landlords review tenants. Only verified tenancies unlock a review.",
  },
];

const AUDIENCES = [
  {
    to: "/for-tenants",
    label: "I rent a home",
    body: "Carry your verified rent history to your next application instead of starting from zero.",
  },
  {
    to: "/for-landlords",
    label: "I own rentals",
    body: "Leases, rent and tenants in one place, with applicants whose history you can actually check.",
  },
  {
    to: "/for-property-managers",
    label: "I am a property manager",
    body: "Owner-granted authority, portfolio KPIs and reporting your owners can see for themselves.",
  },
] as const;

function Landing() {
  return (
    <PublicShell>
      <section className="pt-6 pb-14 sm:pt-14">
        <Eyebrow>Rental trust, built in</Eyebrow>
        <h1 className="mt-3 max-w-2xl font-display text-[40px] leading-[1.05] font-bold tracking-tight sm:text-6xl">
          Everything renting in one place.
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          RentID is the free, all-in-one rental platform built to make life easier for tenants,
          landlords, and property managers.
        </p>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          Build a verified rental history that goes beyond your credit score and creates a rental
          resume you can carry from home to home. Pay rent, build credit through positive rent
          reporting, submit maintenance requests, split rent and utilities with roommates, and keep
          your leases, payments, and rental records organized in one place.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-[14px] font-semibold text-brand-foreground transition-opacity hover:opacity-90"
          >
            Create your RentID
            <ArrowRight className="size-4" />
          </Link>
          <Link
            to="/join"
            className="glass rounded-full px-6 py-3 text-[14px] font-medium transition-opacity hover:opacity-90"
          >
            Pre-register
          </Link>
        </div>

        <div className="mt-14 grid gap-3 sm:grid-cols-3">
          {AUDIENCES.map((audience, i) => (
            <Link
              key={audience.to}
              to={audience.to}
              className="glass rounded-2xl p-5 transition-opacity hover:opacity-90"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <p className="font-display text-[15px] font-semibold tracking-tight">
                {audience.label}
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {audience.body}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent">
                Learn more
                <ArrowRight className="size-3.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="pb-14">
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="glass rounded-2xl p-5"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div className="grid size-9 place-items-center rounded-xl bg-accent/12">
                <f.icon className="size-4 text-accent" strokeWidth={1.75} />
              </div>
              <h3 className="mt-3.5 font-display text-[15px] font-semibold tracking-tight">
                {f.title}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </PublicShell>
  );
}
