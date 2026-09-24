# RentID — original product brief

This is the brief the first version of RentID was built from, kept verbatim as a
record of the original product decisions. It is written as instructions to a
builder, which is why it reads in the imperative.

Where this document and the code disagree, **the code is current**. In
particular the payment architecture has moved on: see
[`rentid-founder-notes-and-payment-providers`](https://github.com/a-a-ronc/RentID)
in the project workspace for the provider evaluation that superseded the Stripe
Connect assumption below.

---

Build a production-quality web application called RentID.

RentID is a two-sided rental platform for landlords and tenants. The long-term goal is to become the trust, reputation, payment, and property-management layer for long-term renting.

The product should combine the simplicity and trust-focused UX of Airbnb with the clear financial dashboards of QuickBooks, without copying either company's design.

## Important Infrastructure Requirements

This application must be built so RentID owns and controls its infrastructure.

Use:

- My own Supabase project for PostgreSQL database, authentication, storage, and backend functions

- My own GitHub repository for source-code ownership

- My own Stripe account later for Stripe Connect

- Environment secrets for all third-party credentials

Do not create a platform-controlled payment account.

Do not implement live Stripe payments yet.

The payment architecture will later use a Stripe Connect platform owned directly by RentID, with landlords as connected accounts. Do not build payment logic that would prevent this architecture later.

The existing domain is:

www.rentid.online

Do NOT change or connect the domain yet. The existing site will remain live while this new application is being built.

The new application will eventually live at:

app.rentid.online

BUILD THIS MOBILE-FIRST

The application must work beautifully on:

- Desktop

- iPhone

- Android

- Tablet

Do not simply shrink a desktop dashboard onto mobile.

We will create native iOS and Android apps later using the same backend, so build the database and backend independently from the web interface.

## Product Concept

RentID has two primary customer types:

## Landlords

Landlords should eventually be able to:

- Manage properties

- Manage units

- Invite tenants

- Manage leases

- Collect rent

- Track payments

- Handle maintenance

- Message tenants

- Review tenants after verified tenancies

- View tenant rental profiles

- View simple financial reporting

## Tenants

Tenants should eventually be able to:

- Accept landlord invitations

- View their tenancy

- View their lease

- Pay rent

- Enable autopay

- Submit maintenance requests

- Message their landlord

- Build a portable verified rental profile

- Review landlords after verified tenancies

The major long-term differentiator is a VERIFIED TWO-WAY RENTAL REPUTATION SYSTEM.

Landlords can review tenants.

Tenants can review landlords.

However, reviews may only come from verified tenancy relationships.

Objective RentID data should eventually be more important than subjective ratings.

Examples:

If RentID processed a rent payment on time, show:

"Verified Payment — Paid On Time"

If RentID records a maintenance request and response timestamps, those timestamps can later contribute to verified landlord responsiveness.

Do not create an arbitrary proprietary Tenant Score.

Traditional credit information may eventually be integrated through a compliant third-party provider, but that is NOT part of this first build.

## Design Direction

The interface should feel:

- Modern

- Premium

- Extremely simple

- Trustworthy

- Consumer-friendly

- Financially clear

Avoid traditional cluttered property-management software.

Use:

- Large clean cards

- Generous spacing

- Clear typography

- Simple icons

- Prominent financial numbers

- Plain-English labels

- Minimal navigation

- Clear calls to action

A new landlord should understand the application without training.

## Branding

Use RentID as the working brand.

Create a simple temporary visual identity that can easily be changed later.

Use reusable design tokens for:

- Primary color

- Accent color

- Background

- Text

- Success

- Warning

- Error

- Borders

Do not hardcode branding throughout individual components.

## User Roles

Create these roles:

1. Landlord

2. Tenant

3. Property Manager

4. Platform Administrator

Use proper role-based permissions.

A landlord must never be able to access another landlord's private property, tenant, financial, lease, or document information.

A tenant must only see information related to their own authorized tenancy relationships.

## Landlord Dashboard

Start the application with a polished landlord dashboard.

The desktop navigation should contain:

Dashboard

Properties

Tenants

Payments

Maintenance

Applications

Messages

Reviews

Documents

Reports

Settings

Payments and several later sections may initially be placeholders, but the architecture should support them.

The landlord dashboard should prominently show:

Rent Collected This Month

Outstanding Rent

Occupied Units

Late Payments

Open Maintenance Requests

Leases Expiring Soon

Use realistic demo data such as:

Rent collected:

$18,450

Outstanding:

$2,100

Occupied:

17 / 19

Open maintenance:

3

Expiring leases:

2

Below those metrics show:

Recent Payments

Upcoming Rent

Late Tenants

Maintenance Requests

Lease Expirations

Important Notifications

Keep the dashboard clean.

Do not overload it with unnecessary charts.

## Properties

Allow landlords to create and manage properties.

Property fields:

- Property name/nickname

- Street address

- City

- State

- ZIP

- Property type

- Number of units

- Property photo

- Notes

- Ownership entity

Allow each property to contain one or more units.

## Unit Fields

- Unit name/number

- Bedrooms

- Bathrooms

- Square footage

- Monthly rent

- Security deposit

- Rent due date

- Occupancy status

- Current tenant

- Lease start

- Lease end

Statuses should include:

Occupied

Vacant

Upcoming Vacancy

## Tenants

Create a tenant directory for landlords.

Show:

Tenant

Property

Unit

Monthly Rent

Lease Dates

Payment Status placeholder

Contact information

Verified Tenancy status

## Tenant Invitations

Allow a landlord to invite a tenant by email and/or phone.

Tenant receives an invitation and creates or joins a RentID account.

When a landlord, tenant, property, unit, and lease are connected, create a:

## Verified Tenancy

This concept is critical to RentID.

Only users connected through a verified tenancy will eventually be permitted to review each other.

## Leases

Allow landlords to:

- Upload a PDF lease

- Associate the lease with a tenant

- Associate it with a property/unit

- Record lease start date

- Record lease end date

- Record monthly rent

- Record security deposit

- Record rent due date

- Record late-fee terms

Do not build a full legal lease generator yet.

## Document Storage

Create secure document storage for:

- Leases

- Move-in inspections

- Move-out inspections

- Notices

- Receipts

- Photos

- Maintenance files

- Other tenancy documents

## Database Architecture

Before adding unnecessary features, create a clean relational schema.

At minimum plan for:

users

profiles

organizations

properties

units

tenancies

leases

tenant_invitations

documents

payments

payment_schedules

maintenance_requests

messages

conversations

reviews

review_disputes

verification_records

notifications

audit_logs

Not all features need to be implemented immediately, but the schema should be designed so they can be added cleanly.

Use:

- Proper foreign keys

- Created/updated timestamps

- Appropriate indexes

- Row Level Security

- Clear ownership relationships

## Supabase Security

Implement Row Level Security from the beginning.

Examples:

A landlord may access only properties they own or are authorized to manage.

A tenant may access only tenancies where they are the authorized tenant.

Documents must inherit tenancy/property permissions.

Admin access must be separated from normal user access.

Do not rely only on frontend hiding for security.

## Onboarding

Landlord onboarding should be very short.

Ask:

How many rental units do you manage?

1

2–5

6–20

21–100

100+

Then guide them through:

Add Property

Add Unit

Invite Tenant

Do not force users through a long setup wizard.

## Tenant Experience

Also create the foundation for a separate tenant interface.

Tenant mobile home screen should eventually show:

## Next Rent Payment

$1,500

Due October 1

Pay Now

Then:

Maintenance

Messages

Lease

Payment History

Rental Profile

Landlord Profile

For now, build the account/tenancy foundation and basic tenant dashboard.

## Payments

Do NOT implement live payment processing yet.

Create the UI/database architecture so payments can be added later.

The future architecture must support:

RentID-owned Stripe Connect platform

Landlord connected accounts

ACH Direct Debit

Debit/credit cards

Autopay

RentID platform/application fees

Stripe webhooks

ACH returns

Refunds

Chargebacks

Payment ledger

Do not assume the exact Stripe Connect charge model yet.

Do not hardcode payment processing assumptions.

## Platform Fee Configuration

Prepare the database/admin architecture so these can later be configurable:

platform_fee_percentage

platform_fee_cap

fee_allocation

The current working business model is approximately:

0.50% RentID platform fee

but this may change.

Do not hardcode it into application logic yet.

## Demo Environment

Populate the application with realistic demo data so the dashboard immediately looks like a functioning rental portfolio.

Use several:

- Properties

- Units

- Tenants

- Leases

- Payment placeholder records

- Maintenance placeholder records

## Quality Requirements

Do not make this only a visual prototype.

Build working:

- Authentication

- Database persistence

- Roles

- Permissions

- Property creation

- Unit creation

- Tenant invitations

- Verified tenancy relationships

- Lease uploads

- Secure document storage

Use reusable components and clean code.

Do not prematurely build:

- Credit screening

- AI tenant scoring

- Automated tenant approvals

- Marketplace listings

- Insurance marketplace

- Contractor marketplace

- QuickBooks replacement

- Listing syndication

- Native apps

- Live Stripe payments

## First Development Milestone

The first milestone is complete when I can:

1. Create a landlord account

2. Complete landlord onboarding

3. Create a property

4. Add a unit

5. Invite a tenant

6. Create/verify the landlord-tenant tenancy relationship

7. Upload and associate a lease

8. Log in as the tenant

9. See that tenancy from the tenant side

10. See the correct landlord dashboard information

Before proceeding beyond this milestone, audit:

- Database schema

- Row Level Security

- User permissions

- Mobile responsiveness

- Code organization

Begin by creating the architecture, Supabase schema, authentication system, design system, and the first functioning landlord dashboard.

Do not connect the RentID domain and do not implement live payments yet.
