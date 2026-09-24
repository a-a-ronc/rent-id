import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AppShell,
  Button,
  DataTable,
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
import { PropertyVerificationCard } from "@/components/rentid/PropertyVerificationCard";
import { PropertyVerificationBadgeButton } from "@/components/rentid/verification-ui";
import { money, shortDate } from "@/lib/format";
import {
  useActiveOrg,
  useCreateUnit,
  useInvitations,
  useInviteTenant,
  useProperty,
  usePropertyVerification,
  useTenancies,
  useUpdateUnit,
} from "@/lib/rentid";
import type { Unit } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/properties/$propertyId")({
  head: () => ({
    meta: [{ title: "Property — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: PropertyDetail,
});

function AddUnitModal({
  propertyId,
  organizationId,
}: {
  propertyId: string;
  organizationId: string | null;
}) {
  const createUnit = useCreateUnit();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    bedrooms: "1",
    bathrooms: "1",
    monthlyRent: "",
    securityDeposit: "",
    rentDueDay: "1",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    try {
      await createUnit.mutateAsync({
        organizationId,
        propertyId,
        name: form.name.trim(),
        bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
        bathrooms: form.bathrooms ? Number(form.bathrooms) : null,
        monthlyRent: form.monthlyRent ? Number(form.monthlyRent) : null,
        securityDeposit: form.securityDeposit ? Number(form.securityDeposit) : null,
        rentDueDay: Number(form.rentDueDay) || 1,
      });
      toast.success("Unit added.");
      setOpen(false);
      setForm({
        name: "",
        bedrooms: "1",
        bathrooms: "1",
        monthlyRent: "",
        securityDeposit: "",
        rentDueDay: "1",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the unit.");
    }
  }

  return (
    <>
      <ToolbarButton label="Add unit" onClick={() => setOpen(true)} />
      <Modal open={open} onClose={() => setOpen(false)} title="Add a unit">
        <form onSubmit={submit} className="space-y-3.5">
          <Field label="Unit name" htmlFor="u-name">
            <TextInput
              id="u-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
              placeholder="Unit 1A"
            />
          </Field>
          <FormGrid className="sm:grid-cols-3">
            <Field label="Beds" htmlFor="u-beds">
              <TextInput
                id="u-beds"
                type="number"
                min={0}
                step="0.5"
                value={form.bedrooms}
                onChange={(e) => set("bedrooms", e.target.value)}
              />
            </Field>
            <Field label="Baths" htmlFor="u-baths">
              <TextInput
                id="u-baths"
                type="number"
                min={0}
                step="0.5"
                value={form.bathrooms}
                onChange={(e) => set("bathrooms", e.target.value)}
              />
            </Field>
            <Field label="Due day" htmlFor="u-due">
              <TextInput
                id="u-due"
                type="number"
                min={1}
                max={28}
                value={form.rentDueDay}
                onChange={(e) => set("rentDueDay", e.target.value)}
              />
            </Field>
          </FormGrid>
          <FormGrid>
            <Field label="Monthly rent" htmlFor="u-rent">
              <TextInput
                id="u-rent"
                type="number"
                min={0}
                value={form.monthlyRent}
                onChange={(e) => set("monthlyRent", e.target.value)}
                placeholder="1400"
              />
            </Field>
            <Field label="Deposit" htmlFor="u-deposit">
              <TextInput
                id="u-deposit"
                type="number"
                min={0}
                value={form.securityDeposit}
                onChange={(e) => set("securityDeposit", e.target.value)}
                placeholder="1400"
              />
            </Field>
          </FormGrid>
          <Button type="submit" loading={createUnit.isPending} className="w-full">
            Save unit
          </Button>
        </form>
      </Modal>
    </>
  );
}

function InviteTenantModal({
  propertyId,
  unitId,
  unitName,
  monthlyRent,
  organizationId,
}: {
  propertyId: string;
  unitId: string;
  unitName: string;
  monthlyRent: number | null;
  organizationId: string | null;
}) {
  const inviteTenant = useInviteTenant();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<{ email: string; token: string } | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    monthlyRent: monthlyRent ? String(monthlyRent) : "",
    startDate: "",
    endDate: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    try {
      const result = await inviteTenant.mutateAsync({
        organizationId,
        propertyId,
        unitId,
        email: form.email.trim().toLowerCase(),
        name: form.name.trim(),
        monthlyRent: form.monthlyRent ? Number(form.monthlyRent) : null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
      });
      setSent({ email: form.email.trim(), token: result.invitation.token });
      toast.success(`Invitation ready for ${form.email.trim()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the invitation.");
    }
  }

  function close() {
    setOpen(false);
    setSent(null);
    setForm({
      name: "",
      email: "",
      monthlyRent: monthlyRent ? String(monthlyRent) : "",
      startDate: "",
      endDate: "",
    });
  }

  return (
    <>
      <Button tone="secondary" size="sm" onClick={() => setOpen(true)}>
        Invite tenant
      </Button>
      <Modal open={open} onClose={close} title={`Invite a tenant — ${unitName}`}>
        {sent ? (
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              An invitation was created for{" "}
              <span className="font-medium text-foreground">{sent.email}</span>. RentID doesn't send
              email yet — <span className="font-medium text-foreground">send them this link</span>{" "}
              and it stays valid for seven days.
            </p>
            <InviteLink token={sent.token} />
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              They'll need to sign up with{" "}
              <span className="font-medium text-foreground">{sent.email}</span> — the invitation is
              tied to that address.
            </p>
            <StatusPill status="Pending" tone="warning" />
            <Button className="w-full" onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3.5">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              You'll get a link to send them. When they accept it from their own account, the
              tenancy becomes a verified tenancy for both sides.
            </p>
            <Field label="Tenant name" htmlFor="i-name">
              <TextInput
                id="i-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
                placeholder="Jordan Smith"
              />
            </Field>
            <Field label="Email" htmlFor="i-email">
              <TextInput
                id="i-email"
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                required
                placeholder="jordan@example.com"
              />
            </Field>
            <FormGrid>
              <Field label="Monthly rent" htmlFor="i-rent">
                <TextInput
                  id="i-rent"
                  type="number"
                  min={0}
                  value={form.monthlyRent}
                  onChange={(e) => set("monthlyRent", e.target.value)}
                />
              </Field>
              <Field label="Start date" htmlFor="i-start">
                <TextInput
                  id="i-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                />
              </Field>
            </FormGrid>
            <Field label="End date" htmlFor="i-end">
              <TextInput
                id="i-end"
                type="date"
                value={form.endDate}
                onChange={(e) => set("endDate", e.target.value)}
              />
            </Field>
            <Button type="submit" loading={inviteTenant.isPending} className="w-full">
              Send invitation
            </Button>
          </form>
        )}
      </Modal>
    </>
  );
}

function UnitActions({
  unit,
  propertyId,
  organizationId,
  tenancyId,
}: {
  unit: Unit;
  propertyId: string;
  organizationId: string | null;
  tenancyId?: string | undefined;
}) {
  const updateUnit = useUpdateUnit();

  async function toggleOccupancy() {
    const next = unit.occupancy_status === "occupied" ? "vacant" : "occupied";
    try {
      await updateUnit.mutateAsync({ unitId: unit.id, patch: { occupancy_status: next } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the unit.");
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
      {tenancyId ? (
        <Link
          to="/tenants/$tenancyId"
          params={{ tenancyId }}
          className="text-[12px] font-medium text-brand"
        >
          View tenant
        </Link>
      ) : (
        <InviteTenantModal
          propertyId={propertyId}
          unitId={unit.id}
          unitName={unit.name}
          monthlyRent={unit.monthly_rent}
          organizationId={organizationId}
        />
      )}
      <Button tone="ghost" size="sm" loading={updateUnit.isPending} onClick={toggleOccupancy}>
        {unit.occupancy_status === "occupied" ? "Vacate" : "Fill"}
      </Button>
    </div>
  );
}

function PropertyDetail() {
  const { propertyId } = Route.useParams();
  const active = useActiveOrg();
  const property = useProperty(propertyId);
  const tenancies = useTenancies(active.orgId);
  const invitations = useInvitations(active.orgId);
  const verification = usePropertyVerification(propertyId);

  if (property.isError) {
    return (
      <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
        <InlineError
          message="Couldn't load this property."
          onRetry={() => void property.refetch()}
        />
      </AppShell>
    );
  }

  if (property.isLoading) {
    return (
      <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
        <LoadingCard label="Loading property…" />
      </AppShell>
    );
  }

  if (!property.data) {
    return (
      <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
        <EmptyState
          title="Property not found"
          description="This property may belong to a different workspace."
          action={
            <Link
              to="/properties"
              className="rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-brand-foreground"
            >
              Back to properties
            </Link>
          }
        />
      </AppShell>
    );
  }

  const p = property.data;
  const units = p.units ?? [];
  const occupied = units.filter((u) => u.occupancy_status === "occupied").length;
  const propertyTenancies = (tenancies.data ?? []).filter((t) => t.property_id === propertyId);
  const propertyInvitations = (invitations.data ?? []).filter(
    (i) => i.property_id === propertyId && i.status === "pending",
  );

  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader
        title={p.name}
        subtitle={`${p.street_address}, ${p.city}, ${p.state} ${p.zip} · ${occupied}/${units.length} occupied`}
        action={<AddUnitModal propertyId={p.id} organizationId={active.orgId} />}
      />

      <div className="mt-3">
        <PropertyVerificationBadgeButton verification={verification.data} size="md" />
      </div>

      <PropertyVerificationCard propertyId={p.id} className="mt-4" />

      <SectionCard title="Units" aside={`${units.length} total`} className="mt-5">
        {units.length === 0 ? (
          <EmptyState
            title="No units yet"
            description="Add a unit to start renting this property."
          />
        ) : (
          <DataTable
            rows={units}
            empty={
              <EmptyState
                title="No units yet"
                description="Add a unit to start renting this property."
              />
            }
            columns={[
              {
                key: "name",
                header: "Unit",
                cell: (u) => <span className="font-medium">{u.name}</span>,
              },
              {
                key: "beds",
                header: "Beds/baths",
                cell: (u) => `${u.bedrooms ?? "—"} bd · ${u.bathrooms ?? "—"} ba`,
                hideOnMobile: true,
              },
              {
                key: "rent",
                header: "Rent",
                cell: (u) => (u.monthly_rent != null ? `${money(Number(u.monthly_rent))}/mo` : "—"),
              },
              {
                key: "status",
                header: "Status",
                cell: (u) => (
                  <StatusPill
                    status={u.occupancy_status === "occupied" ? "Occupied" : "Vacant"}
                    tone={u.occupancy_status === "occupied" ? "success" : "neutral"}
                  />
                ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                cell: (u) => {
                  const tenancy = propertyTenancies.find(
                    (t) => t.unit_id === u.id && t.status !== "cancelled" && t.status !== "ended",
                  );
                  return (
                    <UnitActions
                      unit={u}
                      propertyId={p.id}
                      organizationId={active.orgId}
                      tenancyId={tenancy?.id}
                    />
                  );
                },
              },
            ]}
          />
        )}
      </SectionCard>

      <SectionCard title="Tenancies" aside={`${propertyTenancies.length} total`} className="mt-4">
        {propertyTenancies.length === 0 ? (
          <EmptyState
            title="No tenancies"
            description="No tenancies exist yet for this property."
          />
        ) : (
          propertyTenancies.map((t) => (
            <ListRow
              key={t.id}
              title={t.tenant_name}
              subtitle={t.unit?.name ?? ""}
              pill={
                t.verified ? (
                  <StatusPill status="Verified" tone="success" />
                ) : (
                  <StatusPill
                    status={t.status === "pending" ? "Invited" : t.status}
                    tone="warning"
                  />
                )
              }
              value={
                <Link
                  to="/tenants/$tenancyId"
                  params={{ tenancyId: t.id }}
                  className="text-[12.5px] font-medium text-brand"
                >
                  Manage
                </Link>
              }
            />
          ))
        )}
      </SectionCard>

      <SectionCard
        title="Pending invitations"
        aside={`${propertyInvitations.length} pending`}
        className="mt-4"
      >
        {propertyInvitations.length === 0 ? (
          <EmptyState
            title="No pending invitations"
            description="Invite a tenant from a vacant unit above."
          />
        ) : (
          propertyInvitations.map((inv) => (
            <div key={inv.id} className="border-b border-border/60 py-1 last:border-0">
              <ListRow
                title={inv.invited_name ?? inv.email}
                subtitle={`${inv.unit?.name ?? ""} · Expires ${shortDate(inv.expires_at)}`}
                pill={<StatusPill status="Pending" tone="warning" />}
              />
              <div className="pb-2.5">
                <InviteLink token={inv.token} />
              </div>
            </div>
          ))
        )}
      </SectionCard>
    </AppShell>
  );
}

/* ----------------------------- invitation link ----------------------------- */

/**
 * The landlord's copy of the tenant's accept link. RentID has no outbound mail,
 * so this is the delivery mechanism: the landlord sends it over whatever channel
 * they already use with the tenant.
 */
function InviteLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = `${origin}/invite?token=${encodeURIComponent(token)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked on insecure origins and in some embedded webviews;
      // the input below is selectable, so the link is still reachable by hand.
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-xl border border-border bg-card/70 px-3 py-2 font-mono text-[11.5px] outline-none focus:border-brand/60"
        />
        <Button tone="secondary" size="sm" onClick={copy} className="shrink-0">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
