import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import {
  AppShell,
  ListRow,
  PageHeader,
  SectionCard,
  StatusPill,
  SummaryGrid,
  ToolbarButton,
} from "@/components/rentid/patterns";
import {
  Button,
  Field,
  FormGrid,
  InlineError,
  LoadingCard,
  Modal,
  TextInput,
} from "@/components/rentid/kit";
import { EmptyState } from "@/components/rentid/Surface";
import { money } from "@/lib/format";
import { useCreateOwnerAccount, useManagementOrg, useOwnerAccounts } from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/manager/owners")({
  head: () => ({
    meta: [{ title: "Owners — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: ManagerOwners,
});

function ManagerOwners() {
  const active = useManagementOrg();
  const owners = useOwnerAccounts(active.orgId);
  const createOwner = useCreateOwnerAccount();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [fee, setFee] = useState("8");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!active.orgId) return;
    await createOwner.mutateAsync({
      organizationId: active.orgId,
      name,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      managementFeePct: fee ? Number(fee) : null,
    });
    setName("");
    setContactName("");
    setContactEmail("");
    setOpen(false);
  }

  const totalUnits = (owners.data ?? []).reduce((s, o) => s + o.units_managed, 0);
  const collected = (owners.data ?? []).reduce((s, o) => s + o.collected_this_month, 0);
  const pending = (owners.data ?? []).filter((o) => o.authority_status !== "verified").length;

  return (
    <AppShell subtitle="Property manager" role="manager">
      <PageHeader
        title="Owners"
        subtitle={active.org?.name}
        action={<ToolbarButton label="Add owner" onClick={() => setOpen(true)} />}
      />

      <div className="mt-5">
        <SummaryGrid
          items={[
            { label: "Owners", value: owners.data?.length ?? 0 },
            { label: "Units managed", value: totalUnits },
            { label: "Collected this month", value: money(collected), tone: "success" },
            {
              label: "Authority pending",
              value: pending,
              tone: pending > 0 ? "warning" : "neutral",
              hint: pending > 0 ? "Waiting on owner confirmation" : "All properties authorized",
            },
          ]}
        />
      </div>

      <div className="mt-5 space-y-3">
        {owners.isPending ? (
          <LoadingCard label="Loading owners…" rows={3} />
        ) : owners.isError ? (
          <InlineError message="We couldn't load owners." onRetry={() => void owners.refetch()} />
        ) : owners.data && owners.data.length > 0 ? (
          owners.data.map((owner) => (
            <SectionCard
              key={owner.id}
              title={owner.name}
              aside={`Fee ${owner.management_fee_pct ?? 0}% · since ${owner.contract_start ?? "—"}`}
              footer={
                <p className="text-[12px] text-muted-foreground">
                  {owner.contact_name ?? "Contact on file"}
                  {owner.contact_email ? ` · ${owner.contact_email}` : ""}
                </p>
              }
            >
              <ListRow
                title="Management authority"
                subtitle="Granted by the owner, stored separately from ownership"
                pill={
                  <StatusPill
                    status={
                      owner.authority_status === "verified" ? "authorized" : owner.authority_status
                    }
                    tone={owner.authority_status === "verified" ? "success" : "warning"}
                  />
                }
              />
              <ListRow
                title="Collected this month"
                subtitle={`${owner.occupied_units} of ${owner.units_managed} units occupied`}
                value={money(owner.collected_this_month)}
              />
              {owner.properties.map((property, i) => (
                <ListRow
                  key={property.id}
                  title={property.name}
                  subtitle={`${property.street_address}, ${property.city} ${property.state}`}
                  delay={i * 30}
                />
              ))}
            </SectionCard>
          ))
        ) : (
          <EmptyState
            title="No owners yet"
            description="Record the owners you manage for, their fee and the properties they've authorized."
            action={<Button onClick={() => setOpen(true)}>Add owner</Button>}
          />
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add owner">
        <form onSubmit={submit}>
          <FormGrid>
            <Field label="Owner or entity name">
              <TextInput required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Primary contact">
              <TextInput value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </Field>
            <Field label="Contact email">
              <TextInput
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </Field>
            <Field label="Management fee %" hint="Applied to collected rent">
              <TextInput
                type="number"
                step="0.5"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
              />
            </Field>
          </FormGrid>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Property authority starts pending until the owner confirms it. Badges, listings and
            payout changes stay locked until then.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button tone="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createOwner.isPending} disabled={createOwner.isPending}>
              Add owner
            </Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
