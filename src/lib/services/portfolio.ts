/** Organizations, properties and units — Supabase-backed (RLS-scoped). */
import { db, logAudit, nowIso, unwrap, unwrapMaybe, unwrapOne } from "@/lib/db";
import { toOrganization, toProperty, toUnit } from "@/lib/db/mappers";
import { openPropertyClaim } from "@/lib/services/verification";
import { findDuplicateProperty, normalizeAddress } from "@/lib/verification/address";
import type { TablesUpdate } from "@/integrations/supabase/types";
import type {
  ManagementCategory,
  Organization,
  OrganizationKind,
  Property,
  PropertyClaimRelationship,
  PropertyType,
  PropertyWithUnits,
  Unit,
  UUID,
} from "@/lib/types";

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/* ------------------------------ organizations ----------------------------- */

/**
 * Landlord workspaces the signed-in user owns or belongs to. RLS already
 * scopes the rows; `userId` is kept for hook compatibility.
 */
export async function getOrganizations(userId: UUID | null): Promise<Organization[]> {
  if (!userId) return [];
  const rows = unwrap(
    await db
      .from("organizations")
      .select("*")
      .eq("kind", "landlord")
      .is("deleted_at", null)
      .order("is_demo", { ascending: true })
      .order("created_at", { ascending: false }),
  );
  return rows.map(toOrganization);
}

/** Atomic org + owner membership + role via the create_organization() RPC. */
export async function createOrganization(input: {
  name: string;
  legalEntityName?: string | null;
  ownerId: UUID;
  kind?: OrganizationKind;
}): Promise<Organization> {
  const id = unwrap(
    await db.rpc("create_organization", {
      _name: input.name.trim(),
      _kind: input.kind ?? "landlord",
      ...(input.legalEntityName ? { _legal_entity_name: input.legalEntityName.trim() } : {}),
    }),
  );
  const row = unwrapOne(
    await db.from("organizations").select("*").eq("id", id).single(),
    "Workspace",
  );
  return toOrganization(row);
}

export async function updateOrganization(
  orgId: UUID,
  patch: Partial<Pick<Organization, "name" | "legal_entity_name">>,
): Promise<Organization> {
  const update: TablesUpdate<"organizations"> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.legal_entity_name !== undefined)
    update.legal_entity_name = patch.legal_entity_name?.trim() || null;
  const row = unwrapOne(
    await db.from("organizations").update(update).eq("id", orgId).select("*").single(),
    "Workspace",
  );
  return toOrganization(row);
}

/* -------------------------------- properties ------------------------------ */

type PropertyRowWithUnits = Parameters<typeof toProperty>[0] & {
  units: Parameters<typeof toUnit>[0][];
};

function hydrateProperty(row: PropertyRowWithUnits): PropertyWithUnits {
  return {
    ...toProperty(row),
    units: row.units
      .filter((u) => u.deleted_at === null)
      .map(toUnit)
      .sort(byName),
  };
}

export async function getProperties(orgId: UUID | null): Promise<PropertyWithUnits[]> {
  if (!orgId) return [];
  const rows = unwrap(
    await db
      .from("properties")
      .select("*, units(*)")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("name"),
  );
  return (rows as PropertyRowWithUnits[]).map(hydrateProperty).sort(byName);
}

export async function getProperty(propertyId: UUID): Promise<PropertyWithUnits | null> {
  const row = unwrapMaybe(
    await db
      .from("properties")
      .select("*, units(*)")
      .eq("id", propertyId)
      .is("deleted_at", null)
      .maybeSingle(),
  );
  return row ? hydrateProperty(row as PropertyRowWithUnits) : null;
}

export async function createProperty(input: {
  organizationId: UUID;
  actorId?: UUID | null;
  name: string;
  propertyType: PropertyType;
  /** Operating model — defaults to standard residential. */
  managementCategory?: ManagementCategory;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
  yearBuilt?: number | null;
  notes?: string | null;
  /* ---- property identification for ownership verification ---- */
  county?: string | null;
  parcelNumber?: string | null;
  recordingJurisdiction?: string | null;
  /**
   * Answer to "What is your relationship to this property?". Opens a
   * property-specific verification case; it never grants a badge by itself.
   */
  claimRelationship?: PropertyClaimRelationship;
  claimedOwnerName?: string | null;
}): Promise<Property> {
  const address = {
    street_address: input.streetAddress,
    city: input.city,
    state: input.state,
    zip: input.zip,
  };
  // Reuse the canonical property when the same address already exists in this workspace.
  const existing = unwrap(
    await db
      .from("properties")
      .select("id, name, street_address, city, state, zip, normalized_address")
      .eq("organization_id", input.organizationId)
      .is("deleted_at", null),
  );
  const duplicate = findDuplicateProperty(existing, address);
  if (duplicate)
    throw new Error(`That address already exists in this workspace as "${duplicate.name}".`);

  const row = unwrapOne(
    await db
      .from("properties")
      .insert({
        organization_id: input.organizationId,
        name: input.name.trim(),
        property_type: input.propertyType,
        management_category: input.managementCategory ?? "standard_residential",
        street_address: input.streetAddress.trim(),
        city: input.city.trim(),
        state: input.state.trim().toUpperCase(),
        zip: input.zip.trim(),
        year_built: input.yearBuilt ?? null,
        notes: input.notes?.trim() || null,
        normalized_address: normalizeAddress(address),
        county: input.county?.trim() || null,
        parcel_number: input.parcelNumber?.trim() || null,
        recording_jurisdiction: input.recordingJurisdiction?.trim() || null,
      })
      .select("*")
      .single(),
    "Property",
  );
  const property = toProperty(row);

  await logAudit({
    organization_id: input.organizationId,
    action: "property.created",
    entity_type: "property",
    entity_id: property.id,
    metadata: { name: property.name },
  });

  if (input.claimRelationship) {
    await openPropertyClaim({
      property,
      claimantUserId: input.actorId ?? null,
      claimantName: input.claimedOwnerName?.trim() || null,
      relationship: input.claimRelationship,
      organizationId: input.organizationId,
    });
  }
  return property;
}

export async function updateProperty(
  propertyId: UUID,
  patch: Partial<Pick<Property, "name" | "notes" | "street_address" | "city" | "state" | "zip">>,
): Promise<Property> {
  const update: TablesUpdate<"properties"> = { ...patch };
  if (patch.street_address || patch.city || patch.state || patch.zip) {
    const current = unwrapOne(
      await db
        .from("properties")
        .select("street_address, city, state, zip")
        .eq("id", propertyId)
        .single(),
      "Property",
    );
    update.normalized_address = normalizeAddress({ ...current, ...patch });
  }
  const row = unwrapOne(
    await db.from("properties").update(update).eq("id", propertyId).select("*").single(),
    "Property",
  );
  return toProperty(row);
}

/** Soft delete the property and its units. History (tenancies, payments) stays. */
export async function archiveProperty(propertyId: UUID) {
  const at = nowIso();
  unwrap(
    await db
      .from("units")
      .update({ deleted_at: at })
      .eq("property_id", propertyId)
      .is("deleted_at", null),
  );
  unwrap(await db.from("properties").update({ deleted_at: at }).eq("id", propertyId));
  await logAudit({ action: "property.archived", entity_type: "property", entity_id: propertyId });
  return true;
}

/* ---------------------------------- units --------------------------------- */

export async function getUnits(propertyId?: UUID | null, orgId?: UUID | null): Promise<Unit[]> {
  let query = db.from("units").select("*").is("deleted_at", null).order("name");
  if (propertyId) query = query.eq("property_id", propertyId);
  if (orgId) query = query.eq("organization_id", orgId);
  return unwrap(await query).map(toUnit);
}

export async function getUnit(unitId: UUID): Promise<Unit | null> {
  const row = unwrapMaybe(await db.from("units").select("*").eq("id", unitId).maybeSingle());
  return row ? toUnit(row) : null;
}

export async function createUnit(input: {
  organizationId: UUID;
  propertyId: UUID;
  actorId?: UUID | null;
  name: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  squareFeet?: number | null;
  monthlyRent?: number | null;
  securityDeposit?: number | null;
  rentDueDay?: number;
}): Promise<Unit> {
  const row = unwrapOne(
    await db
      .from("units")
      .insert({
        organization_id: input.organizationId, // overwritten from the property by trigger
        property_id: input.propertyId,
        name: input.name.trim(),
        bedrooms: input.bedrooms ?? null,
        bathrooms: input.bathrooms ?? null,
        square_feet: input.squareFeet ?? null,
        monthly_rent: input.monthlyRent ?? null,
        security_deposit: input.securityDeposit ?? null,
        rent_due_day: input.rentDueDay ?? 1,
        occupancy_status: "vacant",
      })
      .select("*")
      .single(),
    "Unit",
  );
  const unit = toUnit(row);
  await logAudit({
    organization_id: unit.organization_id,
    action: "unit.created",
    entity_type: "unit",
    entity_id: unit.id,
    metadata: { name: unit.name },
  });
  return unit;
}

export async function updateUnit(
  unitId: UUID,
  patch: Partial<
    Pick<
      Unit,
      | "name"
      | "bedrooms"
      | "bathrooms"
      | "square_feet"
      | "monthly_rent"
      | "security_deposit"
      | "rent_due_day"
      | "occupancy_status"
    >
  >,
): Promise<Unit> {
  const row = unwrapOne(
    await db.from("units").update(patch).eq("id", unitId).select("*").single(),
    "Unit",
  );
  return toUnit(row);
}
