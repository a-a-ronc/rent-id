/**
 * React Query hooks over the RentID service layer.
 *
 * Components never talk to a datasource directly — they use these hooks, so
 * replacing the mock services with Supabase queries requires no UI changes.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import * as svc from "@/lib/services";
import type {
  ApplicationStatus,
  ListingStatus,
  DocumentKind,
  MaintenanceRequest,
  MaintenanceStatus,
  Organization,
  Payment,
  PropertyType,
  RoommateGroupStage,
  UUID,
  DisclosureContext,
  PropertyClaimRelationship,
  PropertyPermission,
  PropertyRelationshipKind,
  VerificationProposition,
} from "@/lib/types";

export type { Organization };

const KEYS = [
  "organizations",
  "properties",
  "property",
  "units",
  "tenancies",
  "tenancy",
  "my-tenancies",
  "payments",
  "metrics",
  "maintenance",
  "documents",
  "leases",
  "lease",
  "invitations",
  "my-invitations",
  "conversations",
  "notifications",
  "reviews",
  "profile",
  "roles",
  "audit",
  "managed-payments",
  "managed-work-orders",
  "property-verification",
  "property-badges",
  "verification-queue",
  "disclosure",
];

export function useInvalidateRentId() {
  const qc = useQueryClient();
  return () => {
    for (const key of KEYS) void qc.invalidateQueries({ queryKey: [key] });
  };
}

/* ------------------------------ organizations ----------------------------- */

export function useOrganizations() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["organizations", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => svc.getOrganizations(user!.id),
  });
}

/** The workspace the landlord is acting in: their own, otherwise the demo portfolio. */
export function useActiveOrg() {
  const { user } = useAuth();
  const orgs = useOrganizations();
  const own = orgs.data?.find((o) => !o.is_demo);
  const demo = orgs.data?.find((o) => o.is_demo);
  const active = own ?? demo ?? null;
  return {
    ...orgs,
    org: active,
    orgId: active?.id ?? null,
    isDemo: Boolean(active?.is_demo),
    hasOwnOrg: Boolean(own),
    userId: user?.id ?? null,
  };
}

export function useCreateOrganization() {
  const { user } = useAuth();
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (input: {
      name: string;
      legalEntityName?: string | null;
      kind?: "landlord" | "property_manager";
    }) => svc.createOrganization({ ...input, ownerId: user!.id }),
    onSuccess: invalidate,
  });
}

export function useUpdateOrganization() {
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: ({
      orgId,
      ...patch
    }: {
      orgId: UUID;
      name?: string;
      legal_entity_name?: string | null;
    }) => svc.updateOrganization(orgId, patch),
    onSuccess: invalidate,
  });
}

/* -------------------------------- portfolio ------------------------------- */

export function useProperties(orgId: UUID | null) {
  return useQuery({
    queryKey: ["properties", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getProperties(orgId),
  });
}

export function useProperty(propertyId: UUID) {
  return useQuery({
    queryKey: ["property", propertyId],
    queryFn: () => svc.getProperty(propertyId),
  });
}

export function useCreateProperty() {
  const { user } = useAuth();
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (input: {
      organizationId: UUID;
      name: string;
      propertyType: PropertyType;
      streetAddress: string;
      city: string;
      state: string;
      zip: string;
      yearBuilt?: number | null;
      notes?: string | null;
      county?: string | null;
      parcelNumber?: string | null;
      recordingJurisdiction?: string | null;
      /** Opens a property-specific ownership claim; grants nothing by itself. */
      claimRelationship?: PropertyClaimRelationship;
      claimedOwnerName?: string | null;
    }) => svc.createProperty({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useUnits(propertyId?: UUID | null, orgId?: UUID | null) {
  return useQuery({
    queryKey: ["units", propertyId ?? null, orgId ?? null],
    // Without this the first render fetches every unit RLS allows, then swaps
    // once the active org resolves — a visible flash of the wrong rows.
    enabled: Boolean(propertyId ?? orgId),
    queryFn: () => svc.getUnits(propertyId ?? null, orgId ?? null),
  });
}

export function useCreateUnit() {
  const { user } = useAuth();
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (input: {
      organizationId: UUID;
      propertyId: UUID;
      name: string;
      bedrooms?: number | null;
      bathrooms?: number | null;
      squareFeet?: number | null;
      monthlyRent?: number | null;
      securityDeposit?: number | null;
      rentDueDay?: number;
    }) => svc.createUnit({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useUpdateUnit() {
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: ({
      unitId,
      patch,
    }: {
      unitId: UUID;
      patch: Parameters<typeof svc.updateUnit>[1];
    }) => svc.updateUnit(unitId, patch),
    onSuccess: invalidate,
  });
}

/* -------------------------------- tenancies ------------------------------- */

export function useTenancies(orgId: UUID | null) {
  return useQuery({
    queryKey: ["tenancies", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getTenancies(orgId),
  });
}

export function useTenancy(tenancyId: UUID) {
  return useQuery({
    queryKey: ["tenancy", tenancyId],
    queryFn: () => svc.getTenant(tenancyId),
  });
}

export function useMyTenancies() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-tenancies", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => svc.getMyTenancies(user?.id ?? null),
  });
}

export function useInviteTenant() {
  const { user } = useAuth();
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (input: {
      organizationId: UUID;
      propertyId: UUID;
      unitId: UUID;
      email: string;
      name: string;
      monthlyRent?: number | null;
      securityDeposit?: number | null;
      startDate?: string | null;
      endDate?: string | null;
    }) => svc.inviteTenant({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useVerifyTenancy() {
  const { user } = useAuth();
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (tenancyId: UUID) => svc.verifyTenancy(tenancyId, user?.id ?? null),
    onSuccess: invalidate,
  });
}

export function useEndTenancy() {
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (tenancyId: UUID) => svc.endTenancy(tenancyId),
    onSuccess: invalidate,
  });
}

export function useInvitations(orgId: UUID | null) {
  return useQuery({
    queryKey: ["invitations", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getInvitations(orgId),
  });
}

export function useMyInvitations() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-invitations", user?.email],
    enabled: Boolean(user?.email),
    queryFn: () => svc.getMyInvitations(user?.email ?? null),
  });
}

export function useAcceptInvitation() {
  const { user } = useAuth();
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (invitationId: UUID) =>
      svc.acceptInvitation({ invitationId, userId: user!.id }).then((r) => r.tenancyId),
    onSuccess: invalidate,
  });
}

export function useRevokeInvitation() {
  const invalidate = useInvalidateRentId();
  return useMutation({ mutationFn: (id: UUID) => svc.revokeInvitation(id), onSuccess: invalidate });
}

/* --------------------------------- finance -------------------------------- */

export function usePayments(orgId: UUID | null) {
  return useQuery({
    queryKey: ["payments", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getPayments(orgId),
  });
}

export function useDashboardMetrics(orgId: UUID | null) {
  return useQuery({
    queryKey: ["metrics", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getDashboardMetrics(orgId),
  });
}

export function useMarkPaymentPaid() {
  const { user } = useAuth();
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (paymentId: UUID) => svc.markPaymentPaid(paymentId, user?.id ?? null),
    onSuccess: invalidate,
  });
}

/**
 * Landlord records rent received outside RentID. Lands as `landlord_reported`,
 * so it shows on both ledgers but never carries the verified badge — that is
 * reserved for payments the platform itself settled.
 */
export function useRecordPayment() {
  const { user } = useAuth();
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (input: {
      organizationId: UUID;
      tenancyId: UUID;
      amount: number;
      dueDate: string;
      method?: Payment["method"];
      memo?: string | null;
    }) => svc.recordPayment({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

/* ------------------------------- operations ------------------------------- */

export function useLeases(orgId: UUID | null) {
  return useQuery({
    queryKey: ["leases", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getLeases(orgId),
  });
}

export function useLease(leaseId: UUID) {
  return useQuery({ queryKey: ["lease", leaseId], queryFn: () => svc.getLease(leaseId) });
}

export function useUploadLease() {
  const { user } = useAuth();
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof svc.uploadLease>[0], "actorId">) =>
      svc.uploadLease({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useDocuments(orgId: UUID | null) {
  return useQuery({
    queryKey: ["documents", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getDocuments(orgId),
  });
}

export function useUploadDocument() {
  const { user } = useAuth();
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (input: {
      organizationId: UUID;
      propertyId?: UUID | null;
      unitId?: UUID | null;
      tenancyId?: UUID | null;
      kind: DocumentKind;
      title: string;
      fileName?: string | null;
      fileSize?: number | null;
      mimeType?: string | null;
      /** The bytes. Without this the row is filed at a `pending-upload/` path
       *  that can never resolve, so the document is unopenable forever. */
      file?: File | Blob | null;
      visibleToTenant?: boolean;
    }) => svc.uploadDocument({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useMaintenance(orgId: UUID | null) {
  return useQuery({
    queryKey: ["maintenance", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getMaintenanceRequests(orgId),
  });
}

export function useCreateMaintenance() {
  const { user } = useAuth();
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (input: {
      organizationId: UUID;
      propertyId: UUID;
      unitId: UUID;
      tenancyId?: UUID | null;
      title: string;
      description?: string | null;
      priority?: MaintenanceRequest["priority"];
    }) => svc.createMaintenanceRequest({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useUpdateMaintenanceStatus() {
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: ({ id, status }: { id: UUID; status: MaintenanceStatus }) =>
      svc.updateMaintenanceStatus(id, status),
    onSuccess: invalidate,
  });
}

export function useConversations(input: {
  orgId?: UUID | null;
  tenancyIds?: UUID[];
  viewerRole: "landlord" | "tenant";
}) {
  return useQuery({
    queryKey: ["conversations", input.viewerRole, input.orgId ?? null, input.tenancyIds ?? []],
    queryFn: () => svc.getConversations(input),
  });
}

export function useSendMessage() {
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (input: Parameters<typeof svc.sendMessage>[0]) => svc.sendMessage(input),
    onSuccess: invalidate,
  });
}

export function useNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["notifications", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => svc.getNotifications(user?.id ?? null),
  });
}

export function useReviews(tenancyIds: UUID[]) {
  return useQuery({
    queryKey: ["reviews", tenancyIds],
    queryFn: () => svc.getReviews(tenancyIds),
  });
}

export { tenancyVerification } from "@/lib/services/tenancies";

/* ------------------------ marketplace + management ------------------------ */

const MARKETPLACE_KEYS = [
  "listings",
  "listing",
  // Edit a listing from /listings/$id and /manager/listings kept showing the
  // stale copy — this key was in neither invalidation list.
  "managed-listings",
  "public-listings",
  "applications",
  "my-applications",
  "provider-profile",
  "tenant-passport",
  "pm-organizations",
  "managed-properties",
  "owner-accounts",
  "pm-metrics",
  "listing-by-ref",
  "listing-distribution",
  "listing-leads",
  "listing-sources",
];

export function useInvalidateMarketplace() {
  const qc = useQueryClient();
  return () => {
    for (const key of [...KEYS, ...MARKETPLACE_KEYS])
      void qc.invalidateQueries({ queryKey: [key] });
  };
}

/** The property-management workspace the signed-in manager is acting in. */
export function useManagementOrg() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["pm-organizations", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => svc.getManagementOrganizations(user?.id ?? null),
  });
  const own = query.data?.find((o) => !o.is_demo);
  const demo = query.data?.find((o) => o.is_demo);
  const active = own ?? demo ?? null;
  return { ...query, org: active, orgId: active?.id ?? null, isDemo: Boolean(active?.is_demo) };
}

export function useManagedListings(pmOrgId: UUID | null) {
  return useQuery({
    queryKey: ["managed-listings", pmOrgId],
    enabled: Boolean(pmOrgId),
    queryFn: () => svc.getManagedListings(pmOrgId),
  });
}

export function useManagedProperties(orgId: UUID | null) {
  return useQuery({
    queryKey: ["managed-properties", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getManagedProperties(orgId),
  });
}

export function useOwnerAccounts(orgId: UUID | null) {
  return useQuery({
    queryKey: ["owner-accounts", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getOwnerAccounts(orgId),
  });
}

export function usePmMetrics(orgId: UUID | null) {
  return useQuery({
    queryKey: ["pm-metrics", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getPmPortfolioMetrics(orgId),
  });
}

export function useCreateOwnerAccount() {
  const { user } = useAuth();
  const invalidate = useInvalidateMarketplace();
  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof svc.createOwnerAccount>[0], "actorId">) =>
      svc.createOwnerAccount({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useSetManagementAuthority() {
  const { user } = useAuth();
  const invalidate = useInvalidateMarketplace();
  return useMutation({
    mutationFn: ({
      assignmentId,
      status,
    }: {
      assignmentId: UUID;
      status: "verified" | "disputed" | "revoked";
    }) => svc.setManagementAuthority(assignmentId, status, user?.id ?? null),
    onSuccess: invalidate,
  });
}

export function useProviderProfile(orgId: UUID | null) {
  return useQuery({
    queryKey: ["provider-profile", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getProviderProfile(orgId),
  });
}

export function useTenantPassport(input: { userId?: UUID | null; email?: string | null }) {
  return useQuery({
    queryKey: ["tenant-passport", input.userId ?? null, input.email ?? null],
    enabled: Boolean(input.userId || input.email),
    queryFn: () => svc.getTenantPassport(input),
  });
}

/** Public marketplace search (no session required). */
export function usePublicListings(filters?: {
  query?: string;
  minBeds?: number | null;
  maxRent?: number | null;
  city?: string | null;
}) {
  return useQuery({
    queryKey: ["public-listings", filters ?? {}],
    queryFn: () => svc.searchListings(filters),
  });
}

export function useListing(listingId: UUID) {
  return useQuery({ queryKey: ["listing", listingId], queryFn: () => svc.getListing(listingId) });
}

export function useListings(orgId: UUID | null) {
  return useQuery({
    queryKey: ["listings", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getListings(orgId),
  });
}

export function useCreateListing() {
  const { user } = useAuth();
  const invalidate = useInvalidateMarketplace();
  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof svc.createListing>[0], "actorId">) =>
      svc.createListing({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useUpdateListingStatus() {
  const { user } = useAuth();
  const invalidate = useInvalidateMarketplace();
  return useMutation({
    mutationFn: ({ listingId, status }: { listingId: UUID; status: ListingStatus }) =>
      svc.updateListingStatus(listingId, status, user?.id ?? null),
    onSuccess: invalidate,
  });
}

/* ------------------------- listing syndication ---------------------------- */

/** Public listing by its short reference (rentid.online/listing/<ref>). */
export function useListingByRef(ref: string) {
  return useQuery({ queryKey: ["listing-by-ref", ref], queryFn: () => svc.getListingByRef(ref) });
}

/** Channel states plus the sync history for one listing. */
export function useListingDistribution(listingId: UUID | null) {
  return useQuery({
    queryKey: ["listing-distribution", listingId],
    enabled: Boolean(listingId),
    queryFn: () => svc.getDistribution(listingId as UUID),
  });
}

export function useSetChannelEnabled() {
  const { user } = useAuth();
  const invalidate = useInvalidateMarketplace();
  return useMutation({
    mutationFn: (input: { listingId: UUID; marketplaceId: string; enabled: boolean }) =>
      svc.setChannelEnabled({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useResyncChannel() {
  const invalidate = useInvalidateMarketplace();
  return useMutation({
    mutationFn: (input: { listingId: UUID; marketplaceId: string }) => svc.resyncChannel(input),
    onSuccess: invalidate,
  });
}

export function useUpdateListing() {
  const { user } = useAuth();
  const invalidate = useInvalidateMarketplace();
  return useMutation({
    mutationFn: (input: {
      listingId: UUID;
      patch: Parameters<typeof svc.updateListing>[0]["patch"];
    }) => svc.updateListing({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useListingLeads(orgId: UUID | null) {
  return useQuery({
    queryKey: ["listing-leads", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getLeads(orgId),
  });
}

export function useListingSources(orgId: UUID | null, listingIds?: UUID[]) {
  return useQuery({
    queryKey: ["listing-sources", orgId, listingIds ?? null],
    enabled: Boolean(orgId),
    queryFn: () => svc.getSourceBreakdown(orgId, listingIds),
  });
}

export function useRecordLead() {
  const invalidate = useInvalidateMarketplace();
  return useMutation({
    mutationFn: (input: Parameters<typeof svc.recordLead>[0]) => svc.recordLead(input),
    onSuccess: invalidate,
  });
}

export function useToggleSyndication() {
  const invalidate = useInvalidateMarketplace();
  return useMutation({
    mutationFn: ({ listingId, destination }: { listingId: UUID; destination: string }) =>
      svc.toggleSyndication(listingId, destination),
    onSuccess: invalidate,
  });
}

export function useApplications(orgId: UUID | null) {
  return useQuery({
    queryKey: ["applications", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getApplications(orgId),
  });
}

export function useMyApplications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-applications", user?.id, user?.email],
    enabled: Boolean(user?.id || user?.email),
    queryFn: () => svc.getMyApplications({ userId: user?.id ?? null, email: user?.email ?? null }),
  });
}

export function useApplyToListing() {
  const { user } = useAuth();
  const invalidate = useInvalidateMarketplace();
  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof svc.applyToListing>[0], "applicantUserId">) =>
      svc.applyToListing({ ...input, applicantUserId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useUpdateApplicationStatus() {
  const { user } = useAuth();
  const invalidate = useInvalidateMarketplace();
  return useMutation({
    mutationFn: ({ applicationId, status }: { applicationId: UUID; status: ApplicationStatus }) =>
      svc.updateApplicationStatus(applicationId, status, user?.id ?? null),
    onSuccess: invalidate,
  });
}

/* -------------------- managed portfolio operations (PM) ------------------- */

export function useManagedPayments(orgId: UUID | null) {
  return useQuery({
    queryKey: ["managed-payments", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getManagedPayments(orgId),
  });
}

export function useManagedWorkOrders(orgId: UUID | null) {
  return useQuery({
    queryKey: ["managed-work-orders", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getManagedWorkOrders(orgId),
  });
}

/* ------------------------ student housing (§25-§38) ----------------------- */

function useInvalidateStudent() {
  const qc = useQueryClient();
  return () => {
    [
      "student-properties",
      "student-roster",
      "student-metrics",
      "student-unit",
      "student-ledger-events",
      "student-requests",
      "student-request",
      "student-preleasing",
      "student-turnover",
      "student-maintenance",
      "student-charge",
      "resident-housing",
    ].forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
  };
}

export function useStudentProperties(orgId: UUID | null) {
  return useQuery({
    queryKey: ["student-properties", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getStudentProperties(orgId!),
  });
}

export function useStudentMetrics(orgId: UUID | null) {
  return useQuery({
    queryKey: ["student-metrics", orgId],
    enabled: Boolean(orgId),
    queryFn: () => svc.getStudentMetrics(orgId!),
  });
}

export function useStudentRoster(
  orgId: UUID | null,
  filters?: { propertyId?: UUID; unitId?: UUID },
) {
  return useQuery({
    queryKey: ["student-roster", orgId, filters?.propertyId ?? null, filters?.unitId ?? null],
    enabled: Boolean(orgId),
    queryFn: () => svc.getStudentRoster(orgId!, filters),
  });
}

export function useStudentUnitLedger(unitId: UUID | null) {
  return useQuery({
    queryKey: ["student-unit", unitId],
    enabled: Boolean(unitId),
    queryFn: () => svc.getStudentUnitLedger(unitId!),
  });
}

export function useStudentLedgerEvents(unitId: UUID | null) {
  return useQuery({
    queryKey: ["student-ledger-events", unitId],
    enabled: Boolean(unitId),
    queryFn: () => svc.getUnitLedgerEvents(unitId!),
  });
}

export function useLeaseChangeRequests(orgId: UUID | null, state: "open" | "all" = "open") {
  return useQuery({
    queryKey: ["student-requests", orgId, state],
    enabled: Boolean(orgId),
    queryFn: () => svc.listLeaseChangeRequests(orgId!, { state }),
  });
}

export function useDecideLeaseChange() {
  const { user } = useAuth();
  const invalidate = useInvalidateStudent();
  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof svc.decideLeaseChange>[0], "actorId">) =>
      svc.decideLeaseChange({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useCreateLeaseChangeRequest() {
  const { user } = useAuth();
  const invalidate = useInvalidateStudent();
  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof svc.createLeaseChangeRequest>[0], "actorId">) =>
      svc.createLeaseChangeRequest({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useRecordStudentPayment() {
  const { user } = useAuth();
  const invalidate = useInvalidateStudent();
  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof svc.recordStudentPayment>[0], "actorId">) =>
      svc.recordStudentPayment({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useStudentPreLeasing(orgId: UUID | null, propertyId?: UUID) {
  return useQuery({
    queryKey: ["student-preleasing", orgId, propertyId ?? null],
    enabled: Boolean(orgId),
    queryFn: () => svc.getPreLeasing(orgId!, propertyId),
  });
}

export function useUpdateRoommateGroupStage() {
  const { user } = useAuth();
  const invalidate = useInvalidateStudent();
  return useMutation({
    mutationFn: ({ groupId, stage }: { groupId: UUID; stage: RoommateGroupStage }) =>
      svc.updateRoommateGroupStage(groupId, stage, user?.id ?? null),
    onSuccess: invalidate,
  });
}

export function useStudentTurnover(orgId: UUID | null, propertyId?: UUID) {
  return useQuery({
    queryKey: ["student-turnover", orgId, propertyId ?? null],
    enabled: Boolean(orgId),
    queryFn: () => svc.getTurnover(orgId!, propertyId),
  });
}

export function useUpdateTurnTask() {
  const { user } = useAuth();
  const invalidate = useInvalidateStudent();
  return useMutation({
    mutationFn: ({
      taskId,
      patch,
    }: {
      taskId: UUID;
      patch: Parameters<typeof svc.updateTurnTask>[1];
    }) => svc.updateTurnTask(taskId, patch, user?.id ?? null),
    onSuccess: invalidate,
  });
}

export function useStudentMaintenance(orgId: UUID | null, propertyId?: UUID) {
  return useQuery({
    queryKey: ["student-maintenance", orgId, propertyId ?? null],
    enabled: Boolean(orgId),
    queryFn: () => svc.listStudentMaintenance(orgId!, propertyId),
  });
}

export function useAllocateDamage() {
  const { user } = useAuth();
  const invalidate = useInvalidateStudent();
  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof svc.allocateDamage>[0], "actorId">) =>
      svc.allocateDamage({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useStudentChargeContext(chargeId: UUID | null) {
  return useQuery({
    queryKey: ["student-charge", chargeId],
    enabled: Boolean(chargeId),
    queryFn: () => svc.getStudentChargeContext(chargeId!),
  });
}

export function useUpdateStudentConfig() {
  const { user } = useAuth();
  const invalidate = useInvalidateStudent();
  return useMutation({
    mutationFn: ({
      propertyId,
      patch,
    }: {
      propertyId: UUID;
      patch: Parameters<typeof svc.updateStudentConfig>[1];
    }) => svc.updateStudentConfig(propertyId, patch, user?.id ?? null),
    onSuccess: invalidate,
  });
}

export function useEnableStudentHousing() {
  const { user } = useAuth();
  const invalidate = useInvalidateStudent();
  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof svc.enableStudentHousing>[0], "actorId">) =>
      svc.enableStudentHousing({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

/** Student resident's own housing view (bed, roommates, own money only). */
export function useResidentHousing(userId: string | undefined) {
  return useQuery({
    queryKey: ["resident-housing", userId],
    queryFn: () => svc.getResidentHousing(userId!),
    enabled: Boolean(userId),
  });
}

/* ------------------- property ownership verification ---------------------- */

export function usePropertyVerification(propertyId: UUID | null) {
  return useQuery({
    queryKey: ["property-verification", propertyId],
    enabled: Boolean(propertyId),
    queryFn: () => svc.getPropertyVerification(propertyId),
  });
}

/** Badges for a set of properties — listing cards and lists. */
export function usePropertyBadges(propertyIds: UUID[]) {
  const key = [...propertyIds].sort().join(",");
  return useQuery({
    queryKey: ["property-badges", key],
    enabled: propertyIds.length > 0,
    queryFn: () => svc.getPropertyBadges(propertyIds),
  });
}

export function useStartPropertyClaim() {
  const { user } = useAuth();
  const invalidate = useInvalidateVerification();
  return useMutation({
    mutationFn: (input: {
      propertyId: UUID;
      relationship: PropertyClaimRelationship;
      claimantName?: string | null;
    }) => svc.startPropertyClaim({ ...input, claimantUserId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useSubmitVerificationEvidence() {
  const { user } = useAuth();
  const invalidate = useInvalidateVerification();
  return useMutation({
    mutationFn: (input: {
      caseId: UUID;
      proposition: VerificationProposition;
      evidenceType: string;
      summary: string;
    }) => svc.submitEvidence({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useVerificationQueue() {
  return useQuery({ queryKey: ["verification-queue"], queryFn: () => svc.getVerificationQueue() });
}

export function useDecideVerificationCase() {
  const { user } = useAuth();
  const invalidate = useInvalidateVerification();
  return useMutation({
    mutationFn: (input: { caseId: UUID; decision: svc.ReviewDecision; reason: string }) =>
      svc.decideVerificationCase({ ...input, reviewerId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useAuthorizeRepresentative() {
  const { user } = useAuth();
  const invalidate = useInvalidateVerification();
  return useMutation({
    mutationFn: (input: {
      propertyId: UUID;
      ownerName: string;
      representativeName: string;
      representativeOrganizationId?: UUID | null;
      role?: PropertyRelationshipKind;
      permissions?: PropertyPermission[];
      expiresAt?: string | null;
    }) => svc.authorizeRepresentative({ ...input, ownerUserId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

export function useRevokeAuthorization() {
  const { user } = useAuth();
  const invalidate = useInvalidateVerification();
  return useMutation({
    mutationFn: (input: { authorizationId: UUID; reason: string }) =>
      svc.revokeAuthorization({ ...input, actorId: user?.id ?? null }),
    onSuccess: invalidate,
  });
}

/**
 * Whether this tenant still owes a one-time ownership disclosure for a
 * high-trust action on this property.
 */
export function useDisclosureRequirement(propertyId: UUID | null, context: DisclosureContext) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["disclosure", propertyId, context, user?.id ?? null],
    enabled: Boolean(propertyId),
    queryFn: () =>
      svc.getDisclosureRequirement({ tenantUserId: user?.id ?? null, propertyId, context }),
  });
}

export function useAcknowledgeDisclosure() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { propertyId: UUID; context: DisclosureContext }) =>
      svc.acknowledgeDisclosure({ ...input, tenantUserId: user!.id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["disclosure"] }),
  });
}

function useInvalidateVerification() {
  const qc = useQueryClient();
  return () => {
    for (const key of [
      "property-verification",
      "property-badges",
      "verification-queue",
      "properties",
      "disclosure",
    ]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

/* ------------------------------- invitations ------------------------------ */

/**
 * Preview a tenant invitation by token. The RPC is granted to `authenticated`
 * only, so this stays disabled until the visitor has signed in — /invite shows
 * a sign-up prompt in the meantime.
 */
export function useInvitationPreview(token: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["invitation-preview", token],
    enabled: Boolean(token && user?.id),
    retry: false,
    queryFn: () => svc.previewInvitation(token!),
  });
}

/** Accept an invitation from its token (the shareable /invite link). */
export function useAcceptInvitationToken() {
  const { user } = useAuth();
  const invalidate = useInvalidateRentId();
  return useMutation({
    mutationFn: (token: string) =>
      svc.acceptInvitation({ token, userId: user!.id }).then((r) => r.tenancyId),
    onSuccess: invalidate,
  });
}
