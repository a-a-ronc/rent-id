import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import {
  AppShell,
  PageHeader,
  SectionCard,
  StatusPill,
  SummaryGrid,
} from "@/components/rentid/patterns";
import {
  Button,
  DemoNotice,
  Field,
  LoadingCard,
  Modal,
  Select,
  TextInput,
} from "@/components/rentid/kit";
import { EmptyState, Eyebrow, Glass, Pill } from "@/components/rentid/Surface";
import { money } from "@/lib/format";
import {
  useAllocateDamage,
  useManagementOrg,
  useStudentMaintenance,
  useStudentTurnover,
  useUpdateTurnTask,
} from "@/lib/rentid";
import type { StudentMaintenanceCase } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/manager/student/turnover")({
  head: () => ({
    meta: [{ title: "Turnover & damage — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: TurnoverPage,
});

function TurnoverPage() {
  const active = useManagementOrg();
  const turnover = useStudentTurnover(active.orgId);
  const cases = useStudentMaintenance(active.orgId);
  const updateTask = useUpdateTurnTask();
  const [openCase, setOpenCase] = useState<StudentMaintenanceCase | null>(null);

  if (turnover.isLoading) {
    return (
      <AppShell subtitle="Property manager" role="manager">
        <LoadingCard label="Loading turn board…" rows={5} />
      </AppShell>
    );
  }

  const t = turnover.data;
  if (!t) {
    return (
      <AppShell subtitle="Property manager" role="manager">
        <EmptyState
          title="No turnover data"
          description="Student properties will show their turn board here."
        />
      </AppShell>
    );
  }

  return (
    <AppShell subtitle="Property manager" role="manager">
      <PageHeader
        title="Turnover & damage"
        subtitle="Bed-level readiness, blockers and damage responsibility"
      />

      <SummaryGrid
        className="mt-4"
        items={[
          { label: "Beds ready", value: t.beds_ready, tone: "success" },
          {
            label: "Inspections remaining",
            value: t.inspection_remaining,
            tone: t.inspection_remaining ? "warning" : "success",
          },
          { label: "Make-ready open", value: t.make_ready_open, tone: "warning" },
          {
            label: "Blocked move-ins",
            value: t.move_in_blocked,
            tone: t.move_in_blocked ? "danger" : "success",
          },
        ]}
      />

      <div className="mt-4">
        <DemoNotice>
          Readiness is tracked per bed and per shared area, so one blocked room never marks a whole
          unit ready — and never quietly delays the other residents' move-in.
        </DemoNotice>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <SectionCard title="Turn board" aside={`${t.tasks.length} tasks`}>
          {t.tasks.length === 0 ? (
            <EmptyState
              title="No turn tasks"
              description="Move-out and make-ready work will appear here."
            />
          ) : (
            t.tasks.map((task) => (
              <div key={task.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">{task.label}</p>
                    <p className="num mt-0.5 text-[11.5px] text-muted-foreground">
                      {task.property_name} · {task.unit_name}
                      {task.bed_label ? ` · Bed ${task.bed_label}` : ""} · due {task.due_date}
                      {task.vendor ? ` · ${task.vendor}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill>{task.area}</Pill>
                    <StatusPill
                      status={task.state.replace(/_/g, " ")}
                      tone={
                        task.state === "complete"
                          ? "success"
                          : task.state === "blocked"
                            ? "danger"
                            : task.state === "in_progress"
                              ? "warning"
                              : "neutral"
                      }
                    />
                  </div>
                </div>
                {task.blocker_reason ? (
                  <p className="mt-1.5 text-[12px] text-destructive">
                    Blocked: {task.blocker_reason}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {task.state !== "in_progress" && task.state !== "complete" ? (
                    <Button
                      tone="secondary"
                      onClick={() =>
                        updateTask.mutate({ taskId: task.id, patch: { state: "in_progress" } })
                      }
                    >
                      Start
                    </Button>
                  ) : null}
                  {task.state !== "complete" ? (
                    <Button
                      onClick={() =>
                        updateTask.mutate({ taskId: task.id, patch: { state: "complete" } })
                      }
                    >
                      Mark complete
                    </Button>
                  ) : null}
                  {task.state !== "blocked" && task.state !== "complete" ? (
                    <Button
                      tone="ghost"
                      onClick={() =>
                        updateTask.mutate({
                          taskId: task.id,
                          patch: { state: "blocked", blocker_reason: "Waiting on vendor" },
                        })
                      }
                    >
                      Flag blocker
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </SectionCard>

        <SectionCard
          title="Maintenance & damage cases"
          aside={`${(cases.data ?? []).length} cases`}
        >
          {(cases.data ?? []).length === 0 ? (
            <EmptyState
              title="No cases"
              description="Private-room and shared-area cases appear here."
            />
          ) : (
            (cases.data ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setOpenCase(c)}
                className="flex w-full flex-col items-start px-4 py-3 text-left transition-colors hover:bg-secondary/60"
              >
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                  <p className="truncate text-[13.5px] font-medium">{c.issue}</p>
                  <StatusPill
                    status={c.status.replace(/_/g, " ")}
                    tone={
                      c.status === "disputed"
                        ? "warning"
                        : c.status === "resolved"
                          ? "success"
                          : "accent"
                    }
                  />
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {c.area === "private_room"
                    ? "Private room"
                    : c.area === "shared_area"
                      ? "Shared area"
                      : "Unit"}{" "}
                  · {c.area_label} · {c.requester_name}
                  {c.damage_amount ? ` · ${money(c.damage_amount)}` : ""}
                </p>
              </button>
            ))
          )}
        </SectionCard>
      </div>

      <DamageModal record={openCase} onClose={() => setOpenCase(null)} />
    </AppShell>
  );
}

function DamageModal({
  record,
  onClose,
}: {
  record: StudentMaintenanceCase | null;
  onClose: () => void;
}) {
  const allocate = useAllocateDamage();
  const [target, setTarget] = useState<StudentMaintenanceCase["damage_allocation"]>("unassigned");
  const [amount, setAmount] = useState("");
  const [basis, setBasis] = useState("");
  if (!record) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={record.issue}
      description={`${record.area_label} · reported by ${record.requester_name}`}
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={async () => {
              await allocate.mutateAsync({
                caseId: record.id,
                allocation: target,
                amount: amount ? Number(amount) : record.damage_amount,
                leaseBasis: basis || record.lease_basis || "Shared-area damage clause",
              });
              onClose();
            }}
          >
            Save allocation
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Glass className="p-3">
          <Eyebrow>Evidence on file</Eyebrow>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {record.evidence.length ? record.evidence.join(" · ") : "No evidence attached yet"}
          </p>
          {record.tenant_response ? (
            <>
              <Eyebrow className="mt-3">Resident response</Eyebrow>
              <p className="mt-1 text-[12.5px]">{record.tenant_response}</p>
            </>
          ) : null}
        </Glass>
        <Field
          label="Responsibility"
          hint="Damage responsibility is a documented decision, never a score."
        >
          <Select
            value={target}
            onChange={(e) =>
              setTarget(e.target.value as StudentMaintenanceCase["damage_allocation"])
            }
          >
            <option value="unassigned">Unassigned — still under review</option>
            <option value="single_resident">One resident</option>
            <option value="multiple_residents">Multiple residents</option>
            <option value="household">Whole household</option>
            <option value="owner">Owner / normal wear</option>
          </Select>
        </Field>
        <Field label="Amount">
          <TextInput
            type="number"
            value={amount}
            placeholder={record.damage_amount ? String(record.damage_amount) : "0"}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Lease basis">
          <TextInput
            value={basis}
            placeholder={record.lease_basis ?? "Clause reference"}
            onChange={(e) => setBasis(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
