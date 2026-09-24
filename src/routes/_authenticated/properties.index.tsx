import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AppShell,
  Button,
  EmptyState,
  Field,
  FormGrid,
  InlineError,
  ListRow,
  LoadingCard,
  Modal,
  PageHeader,
  SectionCard,
  Select,
  StatusPill,
  TextInput,
  ToolbarButton,
} from "@/components/rentid/patterns";
import { money } from "@/lib/format";
import { useActiveOrg, useCreateProperty, useProperties } from "@/lib/rentid";
import { CLAIM_LABELS } from "@/lib/services/verification";
import type { PropertyClaimRelationship, PropertyType } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/properties/")({
  head: () => ({
    meta: [{ title: "Properties — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: PropertiesPage,
});

const PROPERTY_TYPES: readonly [PropertyType, string][] = [
  ["single_family", "Single family"],
  ["multi_family", "Multi family"],
  ["condo", "Condo"],
  ["townhouse", "Townhouse"],
  ["apartment", "Apartment"],
];

function AddPropertyModal({ orgId }: { orgId: string | null }) {
  const navigate = useNavigate();
  const createProperty = useCreateProperty();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    streetAddress: "",
    city: "",
    state: "",
    zip: "",
    propertyType: "multi_family" as PropertyType,
    relationship: "individual_owner" as PropertyClaimRelationship,
    county: "",
    parcelNumber: "",
    recordingJurisdiction: "",
    claimedOwnerName: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    try {
      const property = await createProperty.mutateAsync({
        organizationId: orgId,
        name: form.name.trim(),
        propertyType: form.propertyType,
        streetAddress: form.streetAddress.trim(),
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        zip: form.zip.trim(),
        county: form.county.trim() || null,
        parcelNumber: form.parcelNumber.trim() || null,
        recordingJurisdiction: form.recordingJurisdiction.trim() || null,
        claimRelationship: form.relationship,
        claimedOwnerName: form.claimedOwnerName.trim() || null,
      });
      toast.success("Property added.");
      setOpen(false);
      setForm({
        name: "",
        streetAddress: "",
        city: "",
        state: "",
        zip: "",
        propertyType: "multi_family",
        relationship: "individual_owner",
        county: "",
        parcelNumber: "",
        recordingJurisdiction: "",
        claimedOwnerName: "",
      });
      void navigate({ to: "/properties/$propertyId", params: { propertyId: property.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the property.");
    }
  }

  return (
    <>
      <ToolbarButton label="Add property" onClick={() => setOpen(true)} />
      <Modal open={open} onClose={() => setOpen(false)} title="Add a property">
        <form onSubmit={submit} className="space-y-3.5">
          <Field label="Name" htmlFor="p-name">
            <TextInput
              id="p-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
              placeholder="Mapleton Flats"
            />
          </Field>
          <Field label="Street address" htmlFor="p-street">
            <TextInput
              id="p-street"
              value={form.streetAddress}
              onChange={(e) => set("streetAddress", e.target.value)}
              required
              placeholder="1200 Mapleton Ave"
            />
          </Field>
          <FormGrid className="sm:grid-cols-3">
            <Field label="City" htmlFor="p-city">
              <TextInput
                id="p-city"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                required
              />
            </Field>
            <Field label="State" htmlFor="p-state">
              <TextInput
                id="p-state"
                value={form.state}
                onChange={(e) => set("state", e.target.value)}
                required
                maxLength={2}
                placeholder="MI"
              />
            </Field>
            <Field label="ZIP" htmlFor="p-zip">
              <TextInput
                id="p-zip"
                value={form.zip}
                onChange={(e) => set("zip", e.target.value)}
                required
              />
            </Field>
          </FormGrid>
          <Field label="Type" htmlFor="p-type">
            <Select
              id="p-type"
              value={form.propertyType}
              onChange={(e) => set("propertyType", e.target.value)}
            >
              {PROPERTY_TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Your relationship to this property"
            htmlFor="p-rel"
            hint="RentID verifies ownership property by property. Nothing is claimed on your behalf."
          >
            <Select
              id="p-rel"
              value={form.relationship}
              onChange={(e) => set("relationship", e.target.value)}
            >
              {(Object.keys(CLAIM_LABELS) as PropertyClaimRelationship[]).map((key) => (
                <option key={key} value={key}>
                  {CLAIM_LABELS[key]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={
              form.relationship === "individual_owner"
                ? "Name as it appears on the deed"
                : "Legal owner name (entity, trust or person)"
            }
            htmlFor="p-owner"
          >
            <TextInput
              id="p-owner"
              value={form.claimedOwnerName}
              onChange={(e) => set("claimedOwnerName", e.target.value)}
              placeholder={
                form.relationship === "individual_owner"
                  ? "Jordan A. Lucas"
                  : "Lucas Holding Co. LLC"
              }
            />
          </Field>
          <FormGrid>
            <Field label="County" htmlFor="p-county" hint="Used to locate the recorded deed">
              <TextInput
                id="p-county"
                value={form.county}
                onChange={(e) => set("county", e.target.value)}
              />
            </Field>
            <Field label="Parcel / APN / PIN / folio" htmlFor="p-parcel">
              <TextInput
                id="p-parcel"
                value={form.parcelNumber}
                onChange={(e) => set("parcelNumber", e.target.value)}
              />
            </Field>
          </FormGrid>
          <Field
            label="Recording jurisdiction"
            htmlFor="p-jur"
            hint="Optional — register of deeds or recorder's office"
          >
            <TextInput
              id="p-jur"
              value={form.recordingJurisdiction}
              onChange={(e) => set("recordingJurisdiction", e.target.value)}
            />
          </Field>
          <p className="text-[12px] text-muted-foreground">
            Adding a property does not verify ownership. RentID reviews the recorded deed and
            supporting records before any public badge appears.
          </p>
          <Button type="submit" loading={createProperty.isPending} className="w-full">
            Save property
          </Button>
        </form>
      </Modal>
    </>
  );
}

function PropertiesPage() {
  const active = useActiveOrg();
  const properties = useProperties(active.orgId);

  const summary = useMemo(() => {
    const units = (properties.data ?? []).flatMap((p) => p.units ?? []);
    const occupied = units.filter((u) => u.occupancy_status === "occupied").length;
    const rent = units.reduce((sum, u) => sum + Number(u.monthly_rent ?? 0), 0);
    return { total: units.length, occupied, rent };
  }, [properties.data]);

  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader
        title="Properties"
        subtitle={
          active.org
            ? `${active.org.name} · ${summary.total} units · ${summary.occupied} occupied · ${money(summary.rent)}/mo potential`
            : undefined
        }
        action={<AddPropertyModal orgId={active.orgId} />}
      />

      <div className="mt-5 space-y-3">
        {properties.isError ? (
          <InlineError
            message="Couldn't load properties."
            onRetry={() => void properties.refetch()}
          />
        ) : properties.isLoading ? (
          <LoadingCard label="Loading properties…" />
        ) : (properties.data ?? []).length === 0 ? (
          <EmptyState
            title="No properties yet"
            description="Add your first property to start tracking units, leases and rent."
            action={<AddPropertyModal orgId={active.orgId} />}
          />
        ) : (
          (properties.data ?? []).map((p, i) => {
            const units = p.units ?? [];
            const occupied = units.filter((u) => u.occupancy_status === "occupied").length;
            const potential = units.reduce((sum, u) => sum + Number(u.monthly_rent ?? 0), 0);
            return (
              <Link
                key={p.id}
                to="/properties/$propertyId"
                params={{ propertyId: p.id }}
                className="block"
              >
                <SectionCard
                  title={p.name}
                  aside={`${p.city}, ${p.state}`}
                  className="transition-opacity hover:opacity-90"
                >
                  <ListRow
                    title={`${units.length} unit${units.length === 1 ? "" : "s"} · ${occupied} occupied`}
                    subtitle={`${p.street_address} · ${money(potential)}/mo potential`}
                    pill={<StatusPill status={p.property_type.replace("_", " ")} tone="neutral" />}
                    delay={i * 60}
                  />
                </SectionCard>
              </Link>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
