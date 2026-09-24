# Listing Syndication

Turn RentID into the master rental listing system: create a listing once, publish it to RentID and (once partnerships are approved) to outside rental sites, and keep every lead and application coming back into RentID.

This extends the existing property / unit / tenancy / rental-history structure — nothing existing is rebuilt.

## 1. Full listing details

Replace today's short listing form with a proper multi-step listing builder covering everything you listed: address and property name, property type, rent, deposit, available date, beds, baths, square footage, photos, description, amenities, utilities included, pet policy, parking, lease length, application/income/credit requirements, occupancy limits, move-in fees, contact info, and showing instructions.

Existing listings keep working; new fields are optional so nothing breaks.

## 2. Permanent listing ID and public pages

Every listing gets a permanent short RentID reference, plus two public pages:

- `rentid.online/listing/12345` — the public listing page (photos, details, "Apply for this property")
- `rentid.online/apply/12345` — the application page, ready to be used as the "Apply Now" / "Property Website" link on outside sites

The current `/rent` marketplace keeps working and links to the same pages.

## 3. Where would you like to publish this property?

After creating a listing, a distribution step with checkboxes: RentID, Zillow Network, Apartments.com Network, and room for future networks.

RentID publishes for real. Every other network shows **Integration Pending** — nothing is faked as posted, and no scraping or account automation is used anywhere. Only official feeds/APIs, once approved.

## 4. Listing Distribution dashboard

Per listing, a clean panel:

```text
RentID              Live               updated 2 min ago   [Unpublish]
Zillow Network      Integration Pending                    [Resync]
Apartments.com      Integration Pending                    [Resync]
```

Each channel row stores marketplace, external listing ID, connection status, listing status, last sync time, last error, and publish state. Resync queues a sync attempt and records it; pending channels record "awaiting partner approval" rather than pretending to post.

## 5. RentID is the source of truth

Editing rent, photos, availability, description, amenities, lease terms, or status marks every connected channel as "changes pending sync" and queues an outbound update. Marking a listing **Rented** queues removal/deactivation on every channel and closes the listing on RentID immediately.

## 6. Applications auto-filled from the RentID Rental Resume

A signed-in renter's application is pre-filled from their rental resume: name, contact, current and previous addresses, verified rent payments, previous landlords, landlord reviews, rental history summary, employment, income, references. They are only asked for what is missing or what that landlord specifically requires, so applying to several properties doesn't mean retyping everything.

## 7. Applicant pipeline and sources

Per listing: Views, Leads, Applications Started, Applications Completed, Qualified, Approved — with the full status set (New, Application Started, Submitted, Under Review, More Information Requested, Screening, Qualified, Approved, Denied, Withdrawn, Lease Sent, Lease Signed).

Every lead and application records its source — RentID, Zillow, Apartments.com, Direct Link, QR Code, Facebook, Other — captured from UTM/referral parameters on the public listing and apply links, so you can see which sites produce applicants and signed tenants.

## 8. Property manager support

The manager listings desk filters by property, building, owner, status, available date, marketplace, and assigned employee, and groups multiple available units under one property:

```text
Campus Apartments
  Unit 101 — Available
  Unit 102 — Occupied
  Unit 103 — Available
  Unit 201 — Pending Application
```

## 9. Integration layer

A marketplace-adapter structure — nothing hard-coded to Zillow or Apartments.com. Each adapter declares create/update/remove listing, receive leads, receive applications, listing status, external IDs, and error handling. RentID's own adapter is live; partner adapters are registered and pending until approved, and adding a new network later is a single new adapter file.

## Technical notes

- New types: `Listing` extended fields, `ListingChannel`, `ListingSyncEvent`, `ListingLead`, `ApplicationSource`, expanded `ApplicationStatus`, and applicant-pipeline read model in `src/lib/types.ts`.
- Mock DB arrays + seed rows for channels, leads, sync events; services in a new `src/lib/services/syndication.ts` plus extensions to `marketplace.ts`; hooks added to `src/lib/rentid.ts`. UI keeps touching services only.
- Adapter registry at `src/lib/syndication/adapters/` with a `MarketplaceAdapter` interface; `rentid` adapter live, `zillow` / `apartments_com` registered as `integration_pending`.
- Routes: `/listing/$ref` and `/apply/$ref` public; `/listings` (landlord) and `/manager/listings` (PM) rebuilt around the builder, distribution panel and pipeline; listing detail at `/listings/$listingId`.
- Planned SQL/RLS additions appended to `supabase/planned/` (review only, not applied), plus roadmap update.
- Still excluded: Stripe/live payments, screening/background checks, reputation scoring, and any live third-party posting.
