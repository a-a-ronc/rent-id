import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Building2, CheckCircle2, KeyRound, Users } from "lucide-react";
import { useState, type FormEvent } from "react";

import { PublicShell } from "@/components/rentid/PublicShell";
import { Button, Field, TextInput } from "@/components/rentid/kit";
import { Glass } from "@/components/rentid/Surface";
import { cn } from "@/lib/utils";
import { registerInterest, type InterestRole, type RegisterResult } from "@/lib/interest.functions";

const TITLE = "Join RentID — register your interest in the rental platform";
const DESCRIPTION =
  "RentID is an all-in-one rental platform for renters, landlords and property managers. Register your interest before launch — no cost and no obligation.";

export const Route = createFileRoute("/join")({
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
  component: JoinPage,
});

/* ------------------------------- benefits ---------------------------------- */

const COLUMNS = [
  {
    icon: KeyRound,
    role: "For renters",
    lead: "Rent smarter. Build your rental reputation.",
    items: [
      "Build a verified rental history and renter profile.",
      "Show future landlords your history of on-time rent payments.",
      "Positive rent payment credit reporting.",
      "Pay rent and keep payment records organized.",
      "Submit and track maintenance requests.",
      "Split rent and shared expenses between roommates.",
      "Keep leases, documents, payments, and rental records in one place.",
      "Review previous landlords and property managers.",
      "View landlord and property-manager history before renting.",
      "Build a rental resume that follows you from property to property.",
    ],
  },
  {
    icon: Building2,
    role: "For landlords",
    lead: "Manage rentals and build your reputation.",
    items: [
      "Create a verified landlord profile.",
      "Build a history of successful rental relationships.",
      "Receive and track rent payments.",
      "Manage leases and rental documents.",
      "Receive and track maintenance requests.",
      "Communicate with tenants through the platform.",
      "Manage roommate and lease-change requests.",
      "View prospective tenants' rental histories.",
      "Build a reputation based on maintenance response, communication, and tenant reviews.",
      "List available rental properties.",
      "Keep rental records organized in one place.",
    ],
  },
  {
    icon: Users,
    role: "For property managers",
    lead: "Manage multiple properties, owners, and tenants from one platform.",
    items: [
      "Create a verified property-management profile.",
      "Manage multiple properties from one dashboard.",
      "Manage multiple landlords/property owners.",
      "Track rent payments across properties.",
      "See which tenants or roommates have paid and which have not.",
      "Manage maintenance requests across multiple properties.",
      "Manage lease changes, roommate changes, renewals, and approvals.",
      "Organize tenant communications and property records.",
      "Maintain rental and management histories for each property.",
      "Build a public reputation based on tenant experiences and management performance.",
      "List and market available rental properties.",
      "Manage student housing and roommate-heavy properties.",
    ],
  },
] as const;

const ROLE_OPTIONS: { value: InterestRole; label: string }[] = [
  { value: "renter", label: "Renter" },
  { value: "landlord", label: "Landlord" },
  { value: "property_manager", label: "Property manager" },
  { value: "other", label: "Other" },
];

const ACKNOWLEDGEMENT =
  "By submitting this form, I confirm that the information provided is accurate and that my response represents my current interest in using RentID when the platform becomes available. This registration does not create a financial obligation or require me to use RentID.";

/** Progressive U.S. phone formatting as the user types. */
function formatUsPhone(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function JoinPage() {
  return (
    <PublicShell>
      <section className="pt-6 pb-10 sm:pt-10">
        <p className="label-eyebrow">Join RentID · Letter of intent</p>
        <h1 className="mt-3 max-w-2xl font-display text-[32px] leading-[1.08] font-bold tracking-tight sm:text-[44px]">
          Interested in using <span className="text-accent">RentID</span>?
        </h1>
        <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          RentID is building an all-in-one rental platform designed to make renting easier, more
          transparent, and more organized for renters, landlords, and property managers.
        </p>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          If RentID sounds like something you would use, register your interest below. There is no
          cost or obligation to register.
        </p>
      </section>

      <section className="pb-12">
        <div className="grid gap-3 lg:grid-cols-3">
          {COLUMNS.map((col, i) => (
            <Glass key={col.role} className="p-5" delay={i * 60}>
              <div className="grid size-10 place-items-center rounded-2xl bg-accent/15 text-accent">
                <col.icon className="size-5" strokeWidth={1.75} />
              </div>
              <h2 className="mt-3 font-display text-[18px] font-bold tracking-tight">{col.role}</h2>
              <p className="mt-1.5 text-[13.5px] font-medium">{col.lead}</p>
              <ul className="mt-4 space-y-2">
                {col.items.map((item) => (
                  <li
                    key={item}
                    className="flex gap-2 text-[13px] leading-snug text-muted-foreground"
                  >
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-brand" strokeWidth={2} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Glass>
          ))}
        </div>
      </section>

      <section className="pb-14">
        <RegistrationForm />
      </section>
    </PublicShell>
  );
}

/* --------------------------------- the form -------------------------------- */

function RegistrationForm() {
  const submit = useServerFn(registerInterest);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [wouldUse, setWouldUse] = useState<boolean | null>(null);
  const [roles, setRoles] = useState<InterestRole[]>([]);
  const [currentUnits, setCurrentUnits] = useState("");
  const [intendedUnits, setIntendedUnits] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [done, setDone] = useState<null | "created" | "updated">(null);

  function toggleRole(role: InterestRole) {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  /** Unit questions apply once to landlords and/or property managers. */
  const managesUnits = roles.includes("landlord") || roles.includes("property_manager");

  function validate() {
    const next: Record<string, string> = {};
    if (fullName.trim().split(/\s+/).length < 2)
      next["full_name"] = "Enter your first and last name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()))
      next["email"] = "Enter a valid email address";
    if (phone.replace(/\D/g, "").length !== 10)
      next["phone"] = "Enter a 10-digit U.S. phone number";
    if (wouldUse === null) next["would_use"] = "Please select Yes or No";
    if (roles.length === 0) next["roles"] = "Select at least one option";
    if (managesUnits) {
      if (!/^\d+$/.test(currentUnits.trim()) || Number(currentUnits) < 1)
        next["current_units"] = "Enter a whole number of 1 or more";
      if (
        intendedUnits.trim() !== "" &&
        (!/^\d+$/.test(intendedUnits.trim()) || Number(intendedUnits) < 0)
      )
        next["intended_units"] = "Enter a whole number of 0 or more";
    }
    if (!acknowledged) next["acknowledged"] = "Please acknowledge to continue";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function send(updateExisting: boolean) {
    if (pending || done) return;
    if (!validate()) return;
    setPending(true);
    setDuplicate(null);
    try {
      const result = (await submit({
        data: {
          full_name: fullName.trim(),
          email: email.trim(),
          phone,
          roles,
          would_use: wouldUse === true,
          acknowledged: true,
          current_units: managesUnits ? Number(currentUnits) : null,
          intended_units:
            managesUnits && intendedUnits.trim() !== "" ? Number(intendedUnits) : null,
          update_existing: updateExisting,
        },
      })) as RegisterResult;

      if (result.status === "duplicate") setDuplicate(result.message);
      else setDone(result.status);
    } catch {
      setErrors({ form: "We couldn't record your registration. Please try again." });
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(false);
  }

  if (done) {
    return (
      <Glass className="p-6 sm:p-8">
        <div className="grid size-11 place-items-center rounded-2xl bg-brand/15 text-brand">
          <CheckCircle2 className="size-6" strokeWidth={1.75} />
        </div>
        <h2 className="mt-4 font-display text-[24px] font-bold tracking-tight">
          You're registered.
        </h2>
        <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          {done === "updated"
            ? "Thank you — your response has been updated. We'll keep you updated as RentID gets closer to launch."
            : "Thank you for your interest in RentID. Your registration has been recorded. We'll keep you updated as RentID gets closer to launch."}
        </p>
      </Glass>
    );
  }

  return (
    <Glass className="p-5 sm:p-7">
      <h2 className="font-display text-[20px] font-bold tracking-tight">Register your interest</h2>
      <p className="mt-1.5 text-[13px] text-muted-foreground">
        Takes under 30 seconds. No cost, no obligation.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="join-name" error={errors["full_name"] ?? null}>
            <TextInput
              id="join-name"
              name="name"
              autoComplete="name"
              placeholder="First and last name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={120}
              required
            />
          </Field>
          <Field label="Email address" htmlFor="join-email" error={errors["email"] ?? null}>
            <TextInput
              id="join-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={255}
              required
            />
          </Field>
        </div>

        <Field label="Phone number" htmlFor="join-phone" error={errors["phone"] ?? null}>
          <TextInput
            id="join-phone"
            name="tel"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(313) 555-0142"
            value={phone}
            onChange={(e) => setPhone(formatUsPhone(e.target.value))}
            required
          />
        </Field>

        <Field
          label="Would you be interested in using RentID once the platform is completed and available?"
          error={errors["would_use"] ?? null}
        >
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: true, label: "Yes" },
              { value: false, label: "No" },
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                aria-pressed={wouldUse === opt.value}
                onClick={() => setWouldUse(opt.value)}
                className={cn(
                  "rounded-2xl border px-4 py-4 font-display text-[16px] font-semibold transition-all",
                  wouldUse === opt.value
                    ? "border-brand bg-brand text-brand-foreground"
                    : "border-border bg-card/70 hover:border-brand/50",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="How would you primarily use RentID?"
          hint="Select all that apply."
          error={errors["roles"] ?? null}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLE_OPTIONS.map((opt) => {
              const active = roles.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleRole(opt.value)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-[13.5px] font-medium transition-all",
                    active
                      ? "border-brand bg-brand/10 text-foreground"
                      : "border-border bg-card/70 hover:border-brand/50",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-[5px] border",
                      active ? "border-brand bg-brand text-brand-foreground" : "border-border",
                    )}
                  >
                    {active ? <CheckCircle2 className="size-3" strokeWidth={2.5} /> : null}
                  </span>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        {managesUnits ? (
          <div className="grid gap-4 rounded-2xl border border-brand/30 bg-brand/5 p-4 sm:grid-cols-2">
            <Field
              label="How many rental units do you currently own or manage?"
              htmlFor="join-current-units"
              error={errors["current_units"] ?? null}
            >
              <TextInput
                id="join-current-units"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="12"
                value={currentUnits}
                onChange={(e) => setCurrentUnits(e.target.value.replace(/\D/g, ""))}
                required
              />
            </Field>
            <Field
              label="How many rental units would you intend to use RentID for once the platform is available?"
              hint="Optional."
              htmlFor="join-intended-units"
              error={errors["intended_units"] ?? null}
            >
              <TextInput
                id="join-intended-units"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder="12"
                value={intendedUnits}
                onChange={(e) => setIntendedUnits(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          </div>
        ) : null}

        <div className="rounded-2xl border border-border bg-card/60 p-4">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{ACKNOWLEDGEMENT}</p>
          <label className="mt-3 flex items-start gap-2.5 text-[13px] font-medium">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--brand)]"
              required
            />
            <span>I acknowledge and agree.</span>
          </label>
          {errors["acknowledged"] ? (
            <p className="mt-1.5 text-[11.5px] text-destructive">{errors["acknowledged"]}</p>
          ) : null}
        </div>

        {duplicate ? (
          <div className="rounded-2xl border border-accent/40 bg-accent/10 p-4">
            <p className="text-[13px] font-medium">{duplicate}</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              You can update your previous response instead of creating a second registration.
            </p>
            <Button
              tone="secondary"
              size="sm"
              className="mt-3"
              loading={pending}
              disabled={pending}
              onClick={() => void send(true)}
            >
              Update my response
            </Button>
          </div>
        ) : null}

        {errors["form"] ? <p className="text-[12.5px] text-destructive">{errors["form"]}</p> : null}

        <Button
          type="submit"
          className="w-full py-3.5 text-[15px]"
          loading={pending}
          disabled={pending}
        >
          Register My Interest
        </Button>
      </form>
    </Glass>
  );
}
