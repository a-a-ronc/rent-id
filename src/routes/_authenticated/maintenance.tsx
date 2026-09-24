import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import {
  AppShell,
  Button,
  DemoNotice,
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
  SummaryGrid,
  TextArea,
  TextInput,
} from "@/components/rentid/patterns";
import { shortDate } from "@/lib/format";
import {
  useActiveOrg,
  useCreateMaintenance,
  useMaintenance,
  useTenancies,
  useUpdateMaintenanceStatus,
} from "@/lib/rentid";
import type { MaintenancePriority, MaintenanceStatus } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/maintenance")({
  head: () => ({
    meta: [{ title: "Maintenance — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: MaintenancePage,
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

const NEXT_STATUS: Partial<Record<MaintenanceStatus, MaintenanceStatus>> = {
  open: "acknowledged",
  acknowledged: "in_progress",
  in_progress: "completed",
};

const PRIORITY_TONE: Record<MaintenancePriority, "neutral" | "warning" | "danger"> = {
  low: "neutral",
  normal: "neutral",
  high: "warning",
  urgent: "danger",
  emergency: "danger",
};

function MaintenancePage() {
  const active = useActiveOrg();
  const maintenance = useMaintenance(active.orgId);
  const tenancies = useTenancies(active.orgId);
  const create = useCreateMaintenance();
  const advance = useUpdateMaintenanceStatus();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const all = maintenance.data ?? [];
  const openItems = all.filter((m) => m.status !== "completed" && m.status !== "cancelled");
  const urgent = openItems.filter((m) => m.priority === "emergency" || m.priority === "high");
  const rows = (filter === "open" ? openItems : all)
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function next(id: string, status: MaintenanceStatus) {
    const target = NEXT_STATUS[status];
    if (!target) return;
    try {
      await advance.mutateAsync({ id, status: target });
      toast.success(`Moved to ${target.replace("_", " ")}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Status could not be updated.");
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active.orgId) return;
    const form = new FormData(event.currentTarget);
    const tenancy = (tenancies.data ?? []).find(
      (t) => t.id === String(form.get("tenancyId") ?? ""),
    );
    if (!tenancy?.property_id || !tenancy.unit_id) {
      toast.error("Choose a tenancy so the request is attached to a unit.");
      return;
    }
    try {
      await create.mutateAsync({
        organizationId: active.orgId,
        propertyId: tenancy.property_id,
        unitId: tenancy.unit_id,
        tenancyId: tenancy.id,
        title: String(form.get("title") ?? ""),
        description: String(form.get("description") ?? "") || null,
        priority: String(form.get("priority") ?? "normal") as MaintenancePriority,
      });
      toast.success("Request logged.");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not log the request.");
    }
  }

  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader
        title="Maintenance"
        subtitle={active.org?.name}
        action={
          <Button size="sm" onClick={() => setOpen(true)} disabled={!active.orgId}>
            Log request
          </Button>
        }
      />

      <SummaryGrid
        className="mt-5"
        items={[
          {
            label: "Open",
            value: String(openItems.length),
            tone: openItems.length > 0 ? "warning" : "success",
          },
          {
            label: "Urgent",
            value: String(urgent.length),
            tone: urgent.length > 0 ? "danger" : "neutral",
          },
          {
            label: "Completed",
            value: String(all.filter((m) => m.status === "completed").length),
            tone: "success",
          },
          { label: "Total", value: String(all.length), tone: "neutral" },
        ]}
      />

      <div className="mt-5 flex gap-2">
        {(["open", "all"] as const).map((option) => (
          <button
            key={option}
            onClick={() => setFilter(option)}
            className={`rounded-full px-4 py-1.5 font-display text-[12px] font-medium capitalize transition-colors ${
              filter === option ? "bg-brand text-brand-foreground" : "glass text-muted-foreground"
            }`}
          >
            {option === "open" ? "Open work" : "Everything"}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-4">
        <DemoNotice>
          Tenant-reported issues land here the moment they are submitted, with the tenancy, unit and
          property already attached.
        </DemoNotice>

        {maintenance.isLoading ? (
          <LoadingCard label="Loading requests…" />
        ) : maintenance.isError ? (
          <InlineError
            message="Maintenance could not be loaded."
            onRetry={() => void maintenance.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filter === "open" ? "No open work" : "No requests yet"}
            description="Requests raised by tenants or logged by your team appear here with status history."
          />
        ) : (
          <SectionCard title="Requests" aside={`${rows.length} shown`}>
            {rows.map((request) => (
              <ListRow
                key={request.id}
                title={request.title}
                subtitle={[
                  request.property_name,
                  request.unit_name,
                  request.tenant_name,
                  shortDate(request.created_at),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                pill={
                  <div className="flex items-center gap-2">
                    <StatusPill status={request.priority} tone={PRIORITY_TONE[request.priority]} />
                    <StatusPill
                      status={request.status.replace("_", " ")}
                      tone={STATUS_TONE[request.status]}
                    />
                  </div>
                }
                value={
                  NEXT_STATUS[request.status] ? (
                    <Button
                      size="sm"
                      tone="secondary"
                      onClick={() => void next(request.id, request.status)}
                    >
                      {NEXT_STATUS[request.status]!.replace("_", " ")}
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </SectionCard>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Log a maintenance request">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Tenancy" htmlFor="tenancyId">
            <Select id="tenancyId" name="tenancyId" required defaultValue="">
              <option value="">Choose…</option>
              {(tenancies.data ?? []).map((tenancy) => (
                <option key={tenancy.id} value={tenancy.id}>
                  {tenancy.tenant_name} — {tenancy.property?.name ?? ""} {tenancy.unit?.name ?? ""}
                </option>
              ))}
            </Select>
          </Field>
          <FormGrid>
            <Field label="Title" htmlFor="title">
              <TextInput id="title" name="title" required placeholder="Furnace not igniting" />
            </Field>
            <Field label="Priority" htmlFor="priority">
              <Select id="priority" name="priority" defaultValue="normal">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="emergency">Emergency</option>
              </Select>
            </Field>
          </FormGrid>
          <Field label="Details" htmlFor="description">
            <TextArea
              id="description"
              name="description"
              placeholder="Vendor notes, access instructions…"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button tone="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Log request
            </Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
