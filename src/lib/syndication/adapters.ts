/**
 * Marketplace integration layer.
 *
 * RentID is the master listing system; every external rental website is a
 * distribution channel behind an adapter. Adding a network later means adding
 * one adapter here — no other file knows about Zillow or Apartments.com.
 *
 * Compliance rule: adapters may only ever talk to official APIs, approved
 * partner feeds or XML feeds. No scraping, and no automation that signs into
 * a landlord's account on another website. Until a partnership is approved the
 * adapter reports `integration_pending` and performs no external call.
 */
import type {
  ChannelConnectionStatus,
  Listing,
  MarketplaceId,
  SyncAction,
  SyncResult,
} from "@/lib/types";

export type AdapterOutcome = {
  result: SyncResult;
  message: string;
  external_listing_id?: string | null;
};

export type AdapterCapabilities = {
  create_listing: boolean;
  update_listing: boolean;
  remove_listing: boolean;
  receive_leads: boolean;
  receive_applications: boolean;
  listing_status: boolean;
  external_ids: boolean;
};

export type MarketplaceAdapter = {
  id: MarketplaceId;
  name: string;
  /** Short description of the approved transport, shown in the UI. */
  transport: string;
  connection_status: ChannelConnectionStatus;
  /** Whether the landlord can switch this channel on today. */
  selectable: boolean;
  capabilities: AdapterCapabilities;
  /** Public URL pattern the marketplace should point "Apply Now" at. */
  applyUrl: (listing: Listing) => string;
  sync: (action: SyncAction, listing: Listing) => Promise<AdapterOutcome>;
};

const FULL_CAPABILITIES: AdapterCapabilities = {
  create_listing: true,
  update_listing: true,
  remove_listing: true,
  receive_leads: true,
  receive_applications: true,
  listing_status: true,
  external_ids: true,
};

export function listingPath(listing: Listing) {
  return `/listing/${listing.public_ref ?? listing.id}`;
}

export function applyPath(listing: Listing) {
  return `/apply/${listing.public_ref ?? listing.id}`;
}

/** Absolute URL a partner feed would carry. */
export function publicListingUrl(listing: Listing) {
  const origin = typeof window === "undefined" ? "https://rentid.online" : window.location.origin;
  return `${origin}${listingPath(listing)}`;
}

export function publicApplyUrl(listing: Listing, source?: string) {
  const origin = typeof window === "undefined" ? "https://rentid.online" : window.location.origin;
  return `${origin}${applyPath(listing)}${source ? `?source=${source}` : ""}`;
}

/** RentID's own marketplace — always live, always the source of truth. */
const rentidAdapter: MarketplaceAdapter = {
  id: "rentid",
  name: "RentID",
  transport: "Native — RentID marketplace and public listing page",
  connection_status: "connected",
  selectable: true,
  capabilities: FULL_CAPABILITIES,
  applyUrl: (listing) => publicApplyUrl(listing, "rentid"),
  sync: async (action, listing) => {
    if (action === "remove") {
      return { result: "succeeded", message: "Removed from the RentID marketplace." };
    }
    return {
      result: "succeeded",
      message:
        action === "create" ? "Published on the RentID marketplace." : "RentID listing updated.",
      external_listing_id: listing.public_ref ?? listing.id,
    };
  },
};

/**
 * Partner adapter shell. The payload mapping and transport are implemented once
 * the partnership is approved; until then every call is a no-op that records
 * why nothing was sent.
 */
function pendingPartner(input: {
  id: MarketplaceId;
  name: string;
  transport: string;
}): MarketplaceAdapter {
  return {
    id: input.id,
    name: input.name,
    transport: input.transport,
    connection_status: "integration_pending",
    selectable: true,
    capabilities: FULL_CAPABILITIES,
    applyUrl: (listing) => publicApplyUrl(listing, input.id),
    sync: async (action) => ({
      result: "pending_integration",
      message: `${input.name}: ${action} held in the outbound queue — awaiting partner approval of the RentID feed. Nothing was posted.`,
    }),
  };
}

export const MARKETPLACE_ADAPTERS: MarketplaceAdapter[] = [
  rentidAdapter,
  pendingPartner({
    id: "zillow",
    name: "Zillow Network",
    transport: "Official Zillow Rentals partner feed (Zillow, Trulia, HotPads)",
  }),
  pendingPartner({
    id: "apartments_com",
    name: "Apartments.com Network",
    transport: "Official Apartments.com / CoStar partner feed",
  }),
];

export function getAdapter(marketplaceId: MarketplaceId): MarketplaceAdapter | null {
  return MARKETPLACE_ADAPTERS.find((a) => a.id === marketplaceId) ?? null;
}

export function marketplaceName(marketplaceId: MarketplaceId) {
  return getAdapter(marketplaceId)?.name ?? marketplaceId;
}
