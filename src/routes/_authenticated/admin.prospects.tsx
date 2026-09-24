import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell, PageHeader, SectionCard, SummaryGrid } from "@/components/rentid/patterns";
import { Button, DataTable, Field, LoadingCard, Select, TextInput } from "@/components/rentid/kit";
import { EmptyState, Glass } from "@/components/rentid/Surface";
import { useAuth } from "@/lib/auth";
import {
  computeInterestStats,
  listInterestRegistrations,
  type InterestRegistration,
} from "@/lib/interest.functions";

export const Route = createFileRoute("/_authenticated/admin/prospects")({
  head: () => ({
    meta: [{ title: "Prospective users — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminProspects,
});

const ROLE_LABELS: Record<string, string> = {
  renter: "Renter",
  landlord: "Landlord",
  property_manager: "Property manager",
  other: "Other",
};

function roleText(roles: string[]) {
  return roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") || "—";
}

function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

const CODE_KEY = "rentid.admin.prospects.code";

function AdminProspects() {
  const { roles } = useAuth();
  const fetchRows = useServerFn(listInterestRegistrations);
  const [code, setCode] = useState(() =>
    typeof window === "undefined" ? "" : (window.sessionStorage.getItem(CODE_KEY) ?? ""),
  );
  const [codeDraft, setCodeDraft] = useState("");
  const query = useQuery({
    queryKey: ["interest-registrations", code],
    queryFn: () => fetchRows({ data: { access_code: code } }),
    enabled: roles.includes("admin") && code.length > 0,
    retry: false,
  });

  const [search, setSearch] = useState("");
  const [answer, setAnswer] = useState<"all" | "yes" | "no">("all");
  const [role, setRole] = useState<"all" | "renter" | "landlord" | "property_manager">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const rows = query.data?.rows ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (term && ![r.full_name, r.email, r.phone].some((v) => v.toLowerCase().includes(term)))
        return false;
      if (answer === "yes" && !r.would_use) return false;
      if (answer === "no" && r.would_use) return false;
      if (role !== "all" && !r.roles.includes(role)) return false;
      const at = new Date(r.submitted_at).getTime();
      if (from && at < new Date(`${from}T00:00:00`).getTime()) return false;
      if (to && at > new Date(`${to}T23:59:59`).getTime()) return false;
      return true;
    });
  }, [rows, search, answer, role, from, to]);

  function exportCsv() {
    const header = [
      "registration_id",
      "full_name",
      "email",
      "phone",
      "user_roles",
      "would_use_rentid",
      "current_rental_units_owned_or_managed",
      "rental_units_intended_for_rentid",
      "acknowledgement_accepted",
      "submitted_date",
      "submitted_time",
    ];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = filtered.map((r) => {
      const d = new Date(r.submitted_at);
      return [
        r.id,
        r.full_name,
        r.email,
        r.phone,
        r.roles.map((x) => ROLE_LABELS[x] ?? x).join(" | "),
        r.would_use ? "Yes" : "No",
        r.current_units ?? "N/A",
        r.intended_units ?? "N/A",
        r.acknowledged ? "Accepted" : "Not accepted",
        d.toISOString().slice(0, 10),
        d.toISOString().slice(11, 19),
      ]
        .map((v) => esc(String(v)))
        .join(",");
    });

    const s = computeInterestStats(filtered);
    const summary = [
      "",
      esc("REGISTRATION SUMMARY"),
      [esc("Total registrations"), esc(String(s.total))].join(","),
      [esc("Total Yes responses"), esc(String(s.yes))].join(","),
      [esc("Total No responses"), esc(String(s.no))].join(","),
      [esc("Total renters"), esc(String(s.renters))].join(","),
      [esc("Total landlords"), esc(String(s.landlords))].join(","),
      [esc("Total property managers"), esc(String(s.property_managers))].join(","),
      [esc("Total current rental units represented"), esc(String(s.current_units_all))].join(","),
      [
        esc("Total rental units intended for RentID (Yes responses)"),
        esc(String(s.intended_units_yes)),
      ].join(","),
    ];

    const csv = [header.join(","), ...lines, ...summary].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `rentid-prospective-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!roles.includes("admin")) {
    return (
      <AppShell subtitle="Administration">
        <EmptyState
          title="Administrator access only"
          description="Prospective-user registrations are limited to RentID administrators."
        />
      </AppShell>
    );
  }

  const stats = query.data?.stats;

  return (
    <AppShell subtitle="Administration">
      <div className="space-y-5">
        <PageHeader
          title="Prospective users"
          subtitle="Documented registrations of interest from /join"
          action={
            <Button tone="secondary" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="size-3.5" /> Export CSV
            </Button>
          }
        />

        {!code || query.isError ? (
          <Glass className="p-5">
            <h2 className="font-display text-[15px] font-semibold tracking-tight">
              Unlock prospective users
            </h2>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">
              Registrations contain personal contact details, so the list is released server-side
              only. Enter the administrator access code to view, filter and export it.
            </p>
            {query.isError ? (
              <p className="mt-2 text-[12.5px] text-destructive">
                That access code was not accepted.
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field
                label="Administrator access code"
                htmlFor="prospect-code"
                className="min-w-[240px]"
              >
                <TextInput
                  id="prospect-code"
                  type="password"
                  autoComplete="off"
                  value={codeDraft}
                  onChange={(e) => setCodeDraft(e.target.value)}
                />
              </Field>
              <Button
                onClick={() => {
                  window.sessionStorage.setItem(CODE_KEY, codeDraft);
                  setCode(codeDraft);
                }}
                disabled={codeDraft.length === 0}
              >
                Unlock
              </Button>
            </div>
          </Glass>
        ) : null}

        {query.isLoading ? <LoadingCard label="Loading registrations…" /> : null}

        {stats ? (
          <>
            <SummaryGrid
              items={[
                { label: "Total registrations", value: stats.total },
                { label: "Yes responses", value: stats.yes, tone: "success" },
                { label: "No responses", value: stats.no },
                { label: "Answering yes", value: `${stats.yes_percentage}%`, tone: "success" },
              ]}
            />
            <SummaryGrid
              items={[
                { label: "Renters", value: stats.renters },
                { label: "Landlords", value: stats.landlords },
                { label: "Property managers", value: stats.property_managers },
                {
                  label: "This week",
                  value: stats.this_week,
                  hint: `${stats.this_month} this month`,
                },
              ]}
            />
            <Glass className="p-5">
              <p className="label-eyebrow">Primary unit metric</p>
              <p className="mt-2 font-display text-[40px] leading-none font-bold tracking-tight text-brand">
                {stats.intended_units_yes.toLocaleString()}
              </p>
              <p className="mt-2 text-[13px] font-medium">Total units intended for RentID</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Counts only registrations that answered Yes. All respondents together represent{" "}
                {stats.intended_units_all.toLocaleString()} intended units.
              </p>
            </Glass>
            <SummaryGrid
              items={[
                {
                  label: "Current units owned/managed",
                  value: stats.current_units_all.toLocaleString(),
                  hint: `${stats.current_units_yes.toLocaleString()} from Yes responses`,
                },
                {
                  label: "Avg intended units",
                  value: stats.average_intended_units.toLocaleString(),
                  hint: "Per Yes landlord / property manager",
                },
                {
                  label: "Landlords & managers",
                  value: stats.unit_holders,
                  hint: "Counted once each",
                },
                {
                  label: "Intended units (all responses)",
                  value: stats.intended_units_all.toLocaleString(),
                },
              ]}
            />
          </>
        ) : null}

        <SectionCard title="Registrations" aside={`${filtered.length} shown`}>
          <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Search" htmlFor="prospect-search">
              <TextInput
                id="prospect-search"
                placeholder="Name, email or phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            <Field label="Would use RentID" htmlFor="prospect-answer">
              <Select
                id="prospect-answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value as typeof answer)}
              >
                <option value="all">All responses</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </Field>
            <Field label="Role" htmlFor="prospect-role">
              <Select
                id="prospect-role"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
              >
                <option value="all">All roles</option>
                <option value="renter">Renter</option>
                <option value="landlord">Landlord</option>
                <option value="property_manager">Property manager</option>
              </Select>
            </Field>
            <Field label="From" htmlFor="prospect-from">
              <TextInput
                id="prospect-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label="To" htmlFor="prospect-to">
              <TextInput
                id="prospect-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
          </div>

          <DataTable<InterestRegistration>
            rows={filtered}
            empty={
              <div className="px-4 py-6">
                <EmptyState
                  title="No registrations yet"
                  description="Registrations submitted on the public join page appear here."
                />
              </div>
            }
            columns={[
              { key: "name", header: "Name", cell: (r) => r.full_name },
              { key: "email", header: "Email", cell: (r) => r.email },
              { key: "phone", header: "Phone", cell: (r) => r.phone, hideOnMobile: true },
              {
                key: "roles",
                header: "User role",
                cell: (r) => roleText(r.roles),
                hideOnMobile: true,
              },
              {
                key: "would",
                header: "Would use RentID?",
                cell: (r) => (r.would_use ? "Yes" : "No"),
              },
              {
                key: "current_units",
                header: "Current units",
                cell: (r) => r.current_units ?? "—",
                hideOnMobile: true,
                align: "right",
              },
              {
                key: "intended_units",
                header: "Intended units",
                cell: (r) => r.intended_units ?? "—",
                hideOnMobile: true,
                align: "right",
              },
              {
                key: "date",
                header: "Date registered",
                cell: (r) => stamp(r.submitted_at),
                hideOnMobile: true,
                align: "right",
              },
            ]}
          />
        </SectionCard>
      </div>
    </AppShell>
  );
}
