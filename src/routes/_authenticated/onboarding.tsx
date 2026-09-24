import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import {
  Button,
  DemoNotice,
  Eyebrow,
  Field,
  FormGrid,
  Glass,
  Select,
  TextInput,
} from "@/components/rentid/patterns";
import { RentIDLogo } from "@/components/rentid/Logo";
import { useUpdateProfile } from "@/lib/auth";
import { useCreateOrganization, useCreateProperty } from "@/lib/rentid";
import type { PropertyType, UUID } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [{ title: "Set up your workspace — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const createOrg = useCreateOrganization();
  const createProperty = useCreateProperty();
  const updateProfile = useUpdateProfile();
  const [step, setStep] = useState(1);
  const [orgId, setOrgId] = useState<UUID | null>(null);
  const [orgName, setOrgName] = useState("");

  async function submitWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    try {
      const org = await createOrg.mutateAsync({
        name,
        legalEntityName: String(form.get("legalEntityName") ?? "") || null,
      });
      await updateProfile.mutateAsync({
        full_name: String(form.get("fullName") ?? "") || null,
        phone: String(form.get("phone") ?? "") || null,
        onboarded: true,
      });
      setOrgId(org.id);
      setOrgName(org.name);
      setStep(2);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Workspace could not be created.");
    }
  }

  async function submitProperty(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!orgId) return;
    const form = new FormData(event.currentTarget);
    try {
      await createProperty.mutateAsync({
        organizationId: orgId,
        name: String(form.get("name") ?? ""),
        propertyType: String(form.get("propertyType") ?? "single_family") as PropertyType,
        streetAddress: String(form.get("streetAddress") ?? ""),
        city: String(form.get("city") ?? ""),
        state: String(form.get("state") ?? ""),
        zip: String(form.get("zip") ?? ""),
      });
      toast.success("Property added.");
      setStep(3);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Property could not be created.");
    }
  }

  return (
    <main className="relative min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="flex flex-col items-center text-center">
          <RentIDLogo markClassName="size-8" wordmarkClassName="text-[21px]" />
          <Eyebrow className="mt-3">Step {step} of 3</Eyebrow>
          <h1 className="mt-1 font-display text-[22px] font-bold tracking-tight">
            {step === 1
              ? "Set up your workspace"
              : step === 2
                ? "Add your first property"
                : "You're ready"}
          </h1>
          <p className="mt-1.5 max-w-md text-[13px] text-muted-foreground">
            {step === 1
              ? "Your workspace holds the properties, units, tenancies and documents you own or manage."
              : step === 2
                ? "You can skip this and add properties later from the Properties page."
                : `${orgName} is set up. Invite a tenant to create your first verified tenancy.`}
          </p>
        </div>

        <div className="mt-4 flex justify-center gap-1.5">
          {[1, 2, 3].map((index) => (
            <span
              key={index}
              className={`h-1.5 w-10 rounded-full ${index <= step ? "bg-brand" : "bg-secondary"}`}
            />
          ))}
        </div>

        <Glass className="mt-6 p-5">
          {step === 1 ? (
            <form onSubmit={submitWorkspace} className="space-y-3">
              <Field label="Your name" htmlFor="fullName">
                <TextInput id="fullName" name="fullName" required placeholder="Avery Whitfield" />
              </Field>
              <FormGrid>
                <Field label="Workspace name" htmlFor="name" hint="Shown to your tenants.">
                  <TextInput
                    id="name"
                    name="name"
                    required
                    placeholder="Whitfield Property Group"
                  />
                </Field>
                <Field label="Legal entity" htmlFor="legalEntityName" hint="Optional.">
                  <TextInput
                    id="legalEntityName"
                    name="legalEntityName"
                    placeholder="Whitfield Holdings LLC"
                  />
                </Field>
              </FormGrid>
              <Field
                label="Phone"
                htmlFor="phone"
                hint="Optional — used for maintenance escalation."
              >
                <TextInput id="phone" name="phone" placeholder="(313) 555-0110" />
              </Field>
              <Button type="submit" loading={createOrg.isPending} className="w-full">
                Create workspace
              </Button>
            </form>
          ) : step === 2 ? (
            <form onSubmit={submitProperty} className="space-y-3">
              <FormGrid>
                <Field label="Property name" htmlFor="name">
                  <TextInput id="name" name="name" required placeholder="Maple Court Duplex" />
                </Field>
                <Field label="Type" htmlFor="propertyType">
                  <Select id="propertyType" name="propertyType" defaultValue="multi_family">
                    <option value="single_family">Single family</option>
                    <option value="multi_family">Multi family</option>
                    <option value="condo">Condo</option>
                    <option value="townhouse">Townhouse</option>
                    <option value="apartment">Apartment building</option>
                  </Select>
                </Field>
              </FormGrid>
              <Field label="Street address" htmlFor="streetAddress">
                <TextInput
                  id="streetAddress"
                  name="streetAddress"
                  required
                  placeholder="1420 Maple Court"
                />
              </Field>
              <FormGrid className="sm:grid-cols-3">
                <Field label="City" htmlFor="city">
                  <TextInput id="city" name="city" required placeholder="Detroit" />
                </Field>
                <Field label="State" htmlFor="state">
                  <TextInput id="state" name="state" required maxLength={2} placeholder="MI" />
                </Field>
                <Field label="ZIP" htmlFor="zip">
                  <TextInput id="zip" name="zip" required placeholder="48214" />
                </Field>
              </FormGrid>
              <div className="flex gap-2">
                <Button tone="secondary" className="flex-1" onClick={() => setStep(3)}>
                  Skip for now
                </Button>
                <Button type="submit" className="flex-1" loading={createProperty.isPending}>
                  Add property
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <ul className="space-y-2 text-[13px]">
                {[
                  "Add units to each property, with rent and deposit.",
                  "Invite a tenant by email — accepting creates the tenancy.",
                  "Upload the lease to complete the Verified Tenancy.",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                    <span className="text-muted-foreground">{line}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="w-full"
                onClick={() => void navigate({ to: "/dashboard", replace: true })}
              >
                Go to dashboard
              </Button>
              <DemoNotice>
                Your workspace is live. Properties, tenancies and payments you add from here are
                yours — only you and anyone you invite can see them.
              </DemoNotice>
            </div>
          )}
        </Glass>
      </div>
    </main>
  );
}
