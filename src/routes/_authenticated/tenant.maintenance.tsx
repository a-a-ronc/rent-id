import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import {
  AppShell,
  Button,
  DemoNotice,
  EmptyState,
  Field,
  InlineError,
  ListRow,
  LoadingCard,
  Modal,
  PageHeader,
  SectionCard,
  Select,
  StatusPill,
  TextArea,
  TextInput,
  TrustBadge,
} from "@/components/rentid/patterns";
import { shortDate } from "@/lib/format";
import { useCreateMaintenance, useMyTenancies } from "@/lib/rentid";
import type { MaintenancePriority, MaintenanceStatus } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/tenant/maintenance")({
  head: () => ({
    meta: [{ title: "Maintenance — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: TenantMaintenancePage,
});

const STATUS_TONE: Record<MaintenanceStatus, "warning" | "neutral" | "success" | "danger"> = {
  open: "warning",
  acknowledged: "neutral",
  in_progress: "neutral",
  completed: "success",
  resolved: "success",
  closed: "neutral",
  cancelled: "danger",
};

function TenantMaintenancePage() {
  const tenancies = useMyTenancies();
  const create = useCreateMaintenance();
  const [open, setOpen] = useState(false);

  const tenancy = tenancies.data?.[0] ?? null;
  const requests = (tenancy?.maintenance ?? [])
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenancy?.property || !tenancy.unit) return;
    const form = new FormData(event.currentTarget);
    try {
      await create.mutateAsync({
        organizationId: tenancy.organization_id,
        propertyId: tenancy.property.id,
        unitId: tenancy.unit.id,
        tenancyId: tenancy.id,
        title: String(form.get("title") ?? ""),
        description: String(form.get("description") ?? "") || null,
        priority: String(form.get("priority") ?? "normal") as MaintenancePriority,
      });
      toast.success("Request submitted — your landlord has been notified.");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit the request.");
    }
  }

  return (
    <AppShell subtitle="Tenant">
      <PageHeader
        title="Maintenance"
        subtitle={
          tenancy?.property ? `${tenancy.property.name} · ${tenancy.unit?.name ?? ""}` : undefined
        }
        action={
          tenancy ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              Report an issue
            </Button>
          ) : undefined
        }
      />

      <div className="mt-5 space-y-4">
        {tenancies.isLoading ? (
          <LoadingCard label="Loading your requests…" />
        ) : tenancies.isError ? (
          <InlineError
            message="Your maintenance history could not be loaded."
            onRetry={() => void tenancies.refetch()}
          />
        ) : !tenancy ? (
          <EmptyState
            title="No active tenancy"
            description="Once your tenancy is verified you can report maintenance issues here and follow every update."
          />
        ) : (
          <>
            <SectionCard title="Your requests" aside={`${requests.length} total`}>
              {requests.length === 0 ? (
                <EmptyState
                  title="Nothing reported"
                  description="Report a leak, appliance fault or anything that needs attention — your landlord sees it instantly."
                />
              ) : (
                requests.map((request) => (
                  <ListRow
                    key={request.id}
                    title={request.title}
                    subtitle={[shortDate(request.created_at), request.description ?? ""]
                      .filter(Boolean)
                      .join(" · ")}
                    pill={
                      <div className="flex items-center gap-2">
                        <StatusPill
                          status={request.priority}
                          tone={request.priority === "emergency" ? "danger" : "neutral"}
                        />
                        <StatusPill
                          status={request.status.replace("_", " ")}
                          tone={STATUS_TONE[request.status] ?? "neutral"}
                        />
                      </div>
                    }
                  />
                ))
              )}
            </SectionCard>

            <SectionCard title="How requests are handled">
              <div className="space-y-2 px-4 py-3 text-[12.5px] text-muted-foreground">
                <p>
                  Emergencies (flooding, no heat, electrical risk) are flagged to your landlord
                  immediately.
                </p>
                <p>
                  Completed work is recorded on your tenancy history as a verified maintenance
                  event.
                </p>
                <div className="pt-1">
                  <TrustBadge kind="tenant_reported" />
                </div>
              </div>
            </SectionCard>
          </>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Report an issue"
        description="Give your landlord enough detail to act quickly."
      >
        <form onSubmit={submit} className="space-y-3">
          <Field label="What's wrong?" htmlFor="title">
            <TextInput id="title" name="title" required placeholder="Kitchen sink is leaking" />
          </Field>
          <Field label="Priority" htmlFor="priority">
            <Select id="priority" name="priority" defaultValue="normal">
              <option value="low">Low — can wait</option>
              <option value="normal">Normal</option>
              <option value="high">High — affecting daily use</option>
              <option value="emergency">Emergency — unsafe or urgent</option>
            </Select>
          </Field>
          <Field
            label="Details"
            htmlFor="description"
            hint="When it started, what you've tried, access notes."
          >
            <TextArea
              id="description"
              name="description"
              placeholder="Water pools under the cabinet after use…"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button tone="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Submit request
            </Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
