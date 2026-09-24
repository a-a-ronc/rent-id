/**
 * Shared listing-syndication UI: status vocabulary, channel rows and the
 * one listing form used by both "create listing" and "edit listing".
 */
import { useState } from "react";

import { Pill } from "@/components/rentid/Surface";
import { StatusPill } from "@/components/rentid/patterns";
import { Button, Field, FormGrid, Select, TextArea, TextInput } from "@/components/rentid/kit";
import { fullDate } from "@/lib/format";
import { MARKETPLACE_ADAPTERS, marketplaceName } from "@/lib/syndication/adapters";
import type {
  ApplicationStatus,
  ChannelListingStatus,
  LeadSource,
  Listing,
  ListingChannel,
  PropertyType,
  Property,
  Unit,
} from "@/lib/types";

/* ----------------------------- vocabulary --------------------------------- */

type Tone = "neutral" | "success" | "warning" | "danger" | "accent";

export const APPLICATION_STATUSES: { value: ApplicationStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "started", label: "Application started" },
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under review" },
  { value: "more_info_requested", label: "More information requested" },
  { value: "screening", label: "Screening" },
  { value: "qualified", label: "Qualified" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "lease_sent", label: "Lease sent" },
  { value: "lease_signed", label: "Lease signed" },
];

export function applicationLabel(status: ApplicationStatus) {
  if (status === "in_review") return "Under review";
  return APPLICATION_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function applicationTone(status: ApplicationStatus): Tone {
  if (status === "approved" || status === "lease_signed" || status === "qualified")
    return "success";
  if (status === "denied" || status === "withdrawn") return "danger";
  if (status === "more_info_requested") return "warning";
  if (
    status === "under_review" ||
    status === "in_review" ||
    status === "screening" ||
    status === "lease_sent"
  )
    return "accent";
  return "neutral";
}

export const SOURCE_LABELS: Record<LeadSource, string> = {
  rentid: "RentID",
  zillow: "Zillow",
  apartments_com: "Apartments.com",
  direct_link: "Direct link",
  qr_code: "QR code",
  facebook: "Facebook",
  other: "Other",
};

const CHANNEL_STATUS: Record<ChannelListingStatus, { label: string; tone: Tone }> = {
  not_published: { label: "Not published", tone: "neutral" },
  queued: { label: "Queued", tone: "warning" },
  pending_integration: { label: "Integration pending", tone: "warning" },
  live: { label: "Live", tone: "success" },
  pending_sync: { label: "Pending sync", tone: "warning" },
  removal_queued: { label: "Removal queued", tone: "warning" },
  removed: { label: "Removed", tone: "neutral" },
  error: { label: "Error", tone: "danger" },
};

export function ChannelStatusPill({ status }: { status: ChannelListingStatus }) {
  const meta = CHANNEL_STATUS[status] ?? CHANNEL_STATUS.not_published;
  return <StatusPill status={meta.label} tone={meta.tone} />;
}

/** One row of the Listing Distribution panel. */
export function ChannelRow({
  channel,
  busy,
  onToggle,
  onResync,
}: {
  channel: ListingChannel;
  busy?: boolean;
  onToggle: (enabled: boolean) => void;
  onResync: () => void;
}) {
  const adapter = MARKETPLACE_ADAPTERS.find((a) => a.id === channel.marketplace_id);
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13.5px] font-medium">
            {marketplaceName(channel.marketplace_id)}
          </p>
          <ChannelStatusPill status={channel.listing_status} />
        </div>
        <p className="num mt-0.5 text-[11.5px] text-muted-foreground">
          {adapter?.transport ?? "Distribution channel"}
          {channel.external_listing_id ? ` · external ID ${channel.external_listing_id}` : ""}
          {channel.last_synced_at ? ` · last updated ${fullDate(channel.last_synced_at)}` : ""}
        </p>
        {channel.last_error ? (
          <p className="mt-1 text-[11.5px] text-destructive">{channel.last_error}</p>
        ) : null}
        {channel.connection_status === "integration_pending" ? (
          <p className="mt-1 text-[11.5px] text-warning">
            Integration pending — RentID keeps this listing ready and sends it the moment the
            official feed is approved. Nothing is posted through unofficial means.
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" tone="ghost" disabled={busy} onClick={onResync}>
          Resync
        </Button>
        <Button
          size="sm"
          tone={channel.enabled ? "ghost" : "primary"}
          disabled={busy}
          onClick={() => onToggle(!channel.enabled)}
        >
          {channel.enabled ? "Unpublish" : "Publish"}
        </Button>
      </div>
    </div>
  );
}

export function SourcePill({ source }: { source: LeadSource }) {
  return <Pill tone={source === "rentid" ? "accent" : "neutral"}>{SOURCE_LABELS[source]}</Pill>;
}

/* ------------------------------ listing form ------------------------------ */

export type ListingFormValues = {
  propertyId: string;
  unitId: string;
  headline: string;
  description: string;
  monthlyRent: string;
  securityDeposit: string;
  availableOn: string;
  leaseTermMonths: string;
  bedrooms: string;
  bathrooms: string;
  squareFeet: string;
  propertyType: string;
  photos: string;
  amenities: string;
  utilities: string;
  petPolicy: string;
  parking: string;
  applicationRequirements: string;
  incomeRequirement: string;
  creditRequirement: string;
  occupancyLimit: string;
  moveInFees: string;
  applicationFee: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  showingInstructions: string;
  assignedTo: string;
  channels: string[];
};

export function emptyListingValues(): ListingFormValues {
  return {
    propertyId: "",
    unitId: "",
    headline: "",
    description: "",
    monthlyRent: "",
    securityDeposit: "",
    availableOn: "",
    leaseTermMonths: "12",
    bedrooms: "",
    bathrooms: "",
    squareFeet: "",
    propertyType: "apartment",
    photos: "",
    amenities: "",
    utilities: "",
    petPolicy: "",
    parking: "",
    applicationRequirements: "",
    incomeRequirement: "Household income of at least 3x the monthly rent.",
    creditRequirement: "",
    occupancyLimit: "",
    moveInFees: "",
    applicationFee: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    showingInstructions: "",
    assignedTo: "",
    channels: ["rentid"],
  };
}

export function valuesFromListing(listing: Listing): ListingFormValues {
  const base = emptyListingValues();
  return {
    ...base,
    propertyId: listing.property_id,
    unitId: listing.unit_id,
    headline: listing.headline,
    description: listing.description ?? "",
    monthlyRent: String(listing.monthly_rent),
    securityDeposit: listing.security_deposit ? String(listing.security_deposit) : "",
    availableOn: listing.available_on,
    leaseTermMonths: String(listing.lease_term_months),
    bedrooms: listing.bedrooms ? String(listing.bedrooms) : "",
    bathrooms: listing.bathrooms ? String(listing.bathrooms) : "",
    squareFeet: listing.square_feet ? String(listing.square_feet) : "",
    propertyType: listing.property_type ?? "apartment",
    photos: (listing.photos ?? []).join(", "),
    amenities: listing.amenities.join(", "),
    utilities: (listing.utilities_included ?? []).join(", "),
    petPolicy: listing.pet_policy ?? "",
    parking: listing.parking ?? "",
    applicationRequirements: (listing.application_requirements ?? []).join(", "),
    incomeRequirement: listing.income_requirement ?? "",
    creditRequirement: listing.credit_requirement ?? "",
    occupancyLimit: listing.occupancy_limit ? String(listing.occupancy_limit) : "",
    moveInFees: listing.move_in_fees ?? "",
    applicationFee: listing.application_fee ? String(listing.application_fee) : "",
    contactName: listing.contact_name ?? "",
    contactEmail: listing.contact_email ?? "",
    contactPhone: listing.contact_phone ?? "",
    showingInstructions: listing.showing_instructions ?? "",
    assignedTo: listing.assigned_to ?? "",
  };
}

const list = (value: string) =>
  value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const num = (value: string) => (value.trim() === "" ? null : Number(value));

/** Map form values onto the master listing record. */
export function listingDetailFromValues(values: ListingFormValues): Partial<Listing> {
  return {
    bedrooms: num(values.bedrooms),
    bathrooms: num(values.bathrooms),
    square_feet: num(values.squareFeet),
    property_type: (values.propertyType || null) as PropertyType | null,
    photos: list(values.photos),
    utilities_included: list(values.utilities),
    pet_policy: values.petPolicy.trim() || null,
    parking: values.parking.trim() || null,
    application_requirements: list(values.applicationRequirements),
    income_requirement: values.incomeRequirement.trim() || null,
    credit_requirement: values.creditRequirement.trim() || null,
    occupancy_limit: num(values.occupancyLimit),
    move_in_fees: values.moveInFees.trim() || null,
    application_fee: num(values.applicationFee),
    contact_name: values.contactName.trim() || null,
    contact_email: values.contactEmail.trim() || null,
    contact_phone: values.contactPhone.trim() || null,
    showing_instructions: values.showingInstructions.trim() || null,
    assigned_to: values.assignedTo.trim() || null,
  };
}

export function listingCoreFromValues(values: ListingFormValues) {
  return {
    headline: values.headline.trim(),
    description: values.description.trim() || null,
    monthly_rent: Number(values.monthlyRent || 0),
    security_deposit: num(values.securityDeposit),
    available_on: values.availableOn || new Date().toISOString().slice(0, 10),
    lease_term_months: Number(values.leaseTermMonths || 12),
    amenities: list(values.amenities),
  };
}

/**
 * Create-once listing builder. The same form edits the master listing, so the
 * distribution copies always describe the same property.
 */
export function ListingForm({
  values,
  onChange,
  properties,
  units,
  mode,
  submitting = false,
  onSubmit,
  onCancel,
}: {
  values: ListingFormValues;
  onChange: (next: ListingFormValues) => void;
  properties: Property[];
  units: Unit[];
  mode: "create" | "edit";
  submitting?: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const set = <K extends keyof ListingFormValues>(key: K, value: ListingFormValues[K]) =>
    onChange({ ...values, [key]: value });

  const steps = ["The home", "Terms & requirements", "Contact & showing", "Distribution"];

  return (
    <form onSubmit={onSubmit}>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {steps.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            className={
              i === step
                ? "rounded-full bg-brand px-3 py-1.5 text-[11.5px] font-semibold text-brand-foreground"
                : "rounded-full bg-secondary px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {step === 0 ? (
        <FormGrid>
          {mode === "create" ? (
            <>
              <Field label="Property">
                <Select
                  required
                  value={values.propertyId}
                  onChange={(e) => onChange({ ...values, propertyId: e.target.value, unitId: "" })}
                >
                  <option value="">Select a property</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Unit" hint="Only vacant or upcoming units can be listed">
                <Select
                  required
                  value={values.unitId}
                  onChange={(e) => set("unitId", e.target.value)}
                >
                  <option value="">Select a unit</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
          <Field label="Listing headline" className="sm:col-span-2">
            <TextInput
              required
              value={values.headline}
              onChange={(e) => set("headline", e.target.value)}
            />
          </Field>
          <Field label="Property type">
            <Select
              value={values.propertyType}
              onChange={(e) => set("propertyType", e.target.value)}
            >
              <option value="apartment">Apartment</option>
              <option value="single_family">Single family</option>
              <option value="multi_family">Multi family</option>
              <option value="condo">Condo</option>
              <option value="townhouse">Townhouse</option>
            </Select>
          </Field>
          <Field label="Square footage">
            <TextInput
              type="number"
              value={values.squareFeet}
              onChange={(e) => set("squareFeet", e.target.value)}
            />
          </Field>
          <Field label="Bedrooms">
            <TextInput
              type="number"
              value={values.bedrooms}
              onChange={(e) => set("bedrooms", e.target.value)}
            />
          </Field>
          <Field label="Bathrooms">
            <TextInput
              type="number"
              step="0.5"
              value={values.bathrooms}
              onChange={(e) => set("bathrooms", e.target.value)}
            />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <TextArea
              rows={3}
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
          <Field label="Amenities" hint="Comma separated" className="sm:col-span-2">
            <TextInput
              value={values.amenities}
              onChange={(e) => set("amenities", e.target.value)}
            />
          </Field>
          <Field label="Photos" hint="Image links, comma separated" className="sm:col-span-2">
            <TextInput value={values.photos} onChange={(e) => set("photos", e.target.value)} />
          </Field>
        </FormGrid>
      ) : null}

      {step === 1 ? (
        <FormGrid>
          <Field label="Monthly rent">
            <TextInput
              required
              type="number"
              inputMode="numeric"
              value={values.monthlyRent}
              onChange={(e) => set("monthlyRent", e.target.value)}
            />
          </Field>
          <Field label="Security deposit">
            <TextInput
              type="number"
              value={values.securityDeposit}
              onChange={(e) => set("securityDeposit", e.target.value)}
            />
          </Field>
          <Field label="Available date">
            <TextInput
              type="date"
              value={values.availableOn}
              onChange={(e) => set("availableOn", e.target.value)}
            />
          </Field>
          <Field label="Lease length (months)">
            <TextInput
              type="number"
              value={values.leaseTermMonths}
              onChange={(e) => set("leaseTermMonths", e.target.value)}
            />
          </Field>
          <Field label="Utilities included" hint="Comma separated">
            <TextInput
              value={values.utilities}
              onChange={(e) => set("utilities", e.target.value)}
            />
          </Field>
          <Field label="Parking">
            <TextInput value={values.parking} onChange={(e) => set("parking", e.target.value)} />
          </Field>
          <Field label="Pet policy" className="sm:col-span-2">
            <TextInput
              value={values.petPolicy}
              onChange={(e) => set("petPolicy", e.target.value)}
            />
          </Field>
          <Field label="Application requirements" hint="Comma separated" className="sm:col-span-2">
            <TextInput
              value={values.applicationRequirements}
              onChange={(e) => set("applicationRequirements", e.target.value)}
            />
          </Field>
          <Field label="Income requirement">
            <TextInput
              value={values.incomeRequirement}
              onChange={(e) => set("incomeRequirement", e.target.value)}
            />
          </Field>
          <Field label="Credit requirement" hint="Optional">
            <TextInput
              value={values.creditRequirement}
              onChange={(e) => set("creditRequirement", e.target.value)}
            />
          </Field>
          <Field label="Occupancy limit">
            <TextInput
              type="number"
              value={values.occupancyLimit}
              onChange={(e) => set("occupancyLimit", e.target.value)}
            />
          </Field>
          <Field label="Application fee">
            <TextInput
              type="number"
              value={values.applicationFee}
              onChange={(e) => set("applicationFee", e.target.value)}
            />
          </Field>
          <Field label="Move-in fees" className="sm:col-span-2">
            <TextInput
              value={values.moveInFees}
              onChange={(e) => set("moveInFees", e.target.value)}
            />
          </Field>
        </FormGrid>
      ) : null}

      {step === 2 ? (
        <FormGrid>
          <Field label="Contact name">
            <TextInput
              value={values.contactName}
              onChange={(e) => set("contactName", e.target.value)}
            />
          </Field>
          <Field label="Assigned to" hint="Leasing agent or employee">
            <TextInput
              value={values.assignedTo}
              onChange={(e) => set("assignedTo", e.target.value)}
            />
          </Field>
          <Field label="Contact email">
            <TextInput
              type="email"
              value={values.contactEmail}
              onChange={(e) => set("contactEmail", e.target.value)}
            />
          </Field>
          <Field label="Contact phone">
            <TextInput
              value={values.contactPhone}
              onChange={(e) => set("contactPhone", e.target.value)}
            />
          </Field>
          <Field label="Showing instructions" className="sm:col-span-2">
            <TextArea
              rows={3}
              value={values.showingInstructions}
              onChange={(e) => set("showingInstructions", e.target.value)}
            />
          </Field>
        </FormGrid>
      ) : null}

      {step === 3 ? (
        <div>
          <p className="text-[13px] font-medium">Where would you like to publish this property?</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            RentID stays the master listing. Any later change to rent, photos, availability or terms
            is sent out to every channel you switch on here.
          </p>
          <div className="mt-3 space-y-2">
            {MARKETPLACE_ADAPTERS.map((adapter) => {
              const on = values.channels.includes(adapter.id);
              return (
                <label
                  key={adapter.id}
                  className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border/70 px-3.5 py-3"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      set(
                        "channels",
                        on
                          ? values.channels.filter((c) => c !== adapter.id)
                          : [...values.channels, adapter.id],
                      )
                    }
                    className="mt-0.5 size-4 accent-[var(--brand)]"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium">{adapter.name}</span>
                      {adapter.connection_status === "connected" ? (
                        <StatusPill status="Live" tone="success" />
                      ) : (
                        <StatusPill status="Integration pending" tone="warning" />
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                      {adapter.transport}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button tone="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {step < steps.length - 1 ? (
          <Button onClick={() => setStep(step + 1)}>Next</Button>
        ) : (
          <Button type="submit" loading={submitting} disabled={submitting}>
            {mode === "create" ? "Publish listing" : "Save changes"}
          </Button>
        )}
      </div>
    </form>
  );
}
