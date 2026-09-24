import { createFileRoute } from "@tanstack/react-router";
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
  LoadingCard,
  Modal,
  PageHeader,
  SectionCard,
  Select,
  StatusPill,
  TextInput,
} from "@/components/rentid/patterns";
import { shortDate } from "@/lib/format";
import { OpenDocumentButton } from "@/components/rentid/OpenDocumentButton";
import {
  useActiveOrg,
  useDocuments,
  useProperties,
  useTenancies,
  useUploadDocument,
} from "@/lib/rentid";
import type { DocumentKind, DocumentWithContext } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({
    meta: [{ title: "Documents — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: DocumentsPage,
});

const KINDS: { value: DocumentKind; label: string }[] = [
  { value: "lease", label: "Lease" },
  { value: "addendum", label: "Addendum" },
  { value: "inspection", label: "Inspection" },
  { value: "notice", label: "Notice" },
  { value: "receipt", label: "Receipt" },
  { value: "id_verification", label: "ID verification" },
  { value: "other", label: "Other" },
];

function DocumentsPage() {
  const active = useActiveOrg();
  const documents = useDocuments(active.orgId);
  const properties = useProperties(active.orgId);
  const tenancies = useTenancies(active.orgId);
  const upload = useUploadDocument();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active.orgId) return;
    const form = new FormData(event.currentTarget);
    const tenancyId = String(form.get("tenancyId") ?? "") || null;
    const tenancy = (tenancies.data ?? []).find((t) => t.id === tenancyId) ?? null;
    try {
      await upload.mutateAsync({
        organizationId: active.orgId,
        propertyId: tenancy?.property_id ?? (String(form.get("propertyId") ?? "") || null),
        unitId: tenancy?.unit_id ?? null,
        tenancyId,
        kind: String(form.get("kind") ?? "other") as DocumentKind,
        title: String(form.get("title") ?? ""),
        fileName: file?.name ?? null,
        fileSize: file?.size ?? null,
        mimeType: file?.type ?? null,
        file,
        visibleToTenant: form.get("visibleToTenant") === "on",
      });
      toast.success("Document filed.");
      setFile(null);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    }
  }

  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader
        title="Documents"
        subtitle={
          active.org ? `${active.org.name} · ${(documents.data ?? []).length} filed` : undefined
        }
        action={
          <Button size="sm" onClick={() => setOpen(true)} disabled={!active.orgId}>
            Upload document
          </Button>
        }
      />

      <div className="mt-5 space-y-4">
        {documents.isLoading ? (
          <LoadingCard label="Loading documents…" />
        ) : documents.isError ? (
          <InlineError
            message="Documents could not be loaded."
            onRetry={() => void documents.refetch()}
          />
        ) : (
          <SectionCard title="All documents" aside={`${(documents.data ?? []).length} total`}>
            <DataTable<DocumentWithContext>
              rows={documents.data ?? []}
              empty={
                <EmptyState
                  title="No documents yet"
                  description="Upload a lease, inspection report or notice and associate it with a property, unit or tenancy."
                  action={<Button onClick={() => setOpen(true)}>Upload document</Button>}
                />
              }
              columns={[
                {
                  key: "title",
                  header: "Document",
                  cell: (d) => (
                    <div className="min-w-0">
                      <p className="truncate font-medium">{d.title}</p>
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {[d.property_name, d.unit_name, d.tenant_name]
                          .filter(Boolean)
                          .join(" · ") || "Unassigned"}
                      </p>
                    </div>
                  ),
                },
                {
                  key: "kind",
                  header: "Kind",
                  cell: (d) => <StatusPill status={d.kind} tone="accent" />,
                },
                {
                  key: "shared",
                  header: "Tenant access",
                  hideOnMobile: true,
                  cell: (d) => (
                    <StatusPill
                      status={d.visible_to_tenant ? "shared" : "private"}
                      tone={d.visible_to_tenant ? "success" : "neutral"}
                    />
                  ),
                },
                {
                  key: "date",
                  header: "Filed",
                  align: "right",
                  hideOnMobile: true,
                  cell: (d) => <span className="num">{shortDate(d.created_at)}</span>,
                },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  cell: (d) => <OpenDocumentButton storagePath={d.storage_path} />,
                },
              ]}
            />
          </SectionCard>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Upload document"
        description="Associate the document so both sides see it in context."
      >
        <form onSubmit={submit} className="space-y-3">
          <Field label="Title" htmlFor="title">
            <TextInput id="title" name="title" required placeholder="2026 lease — Unit 2B" />
          </Field>
          <FormGrid>
            <Field label="Kind" htmlFor="kind">
              <Select id="kind" name="kind" defaultValue="lease">
                {KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Property" htmlFor="propertyId" hint="Optional if a tenancy is chosen.">
              <Select id="propertyId" name="propertyId" defaultValue="">
                <option value="">—</option>
                {(properties.data ?? []).map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <Field
            label="Tenancy"
            htmlFor="tenancyId"
            hint="Links the document to a tenant and unit."
          >
            <Select id="tenancyId" name="tenancyId" defaultValue="">
              <option value="">—</option>
              {(tenancies.data ?? []).map((tenancy) => (
                <option key={tenancy.id} value={tenancy.id}>
                  {tenancy.tenant_name} — {tenancy.unit?.name ?? ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="File"
            htmlFor="file"
            hint="PDF or image. Stored in-session until storage reconnects."
          >
            <input
              id="file"
              type="file"
              accept="application/pdf,image/*"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="w-full rounded-xl border border-border bg-card/70 px-3 py-2.5 text-[12.5px]"
            />
          </Field>
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <input
              type="checkbox"
              name="visibleToTenant"
              defaultChecked
              className="size-4 accent-[var(--brand)]"
            />
            Visible to the tenant
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button tone="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={upload.isPending}>
              Upload
            </Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
