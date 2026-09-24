/**
 * /invite?token=… — the shareable link a landlord sends to a tenant.
 *
 * RentID has no outbound email yet, so the landlord copies this link from the
 * invite dialog and sends it however they already talk to their tenant. The
 * link is what closes the loop: without it an invitation sits in the database
 * and the tenant never learns it exists.
 *
 * `invitation_preview` and `accept_invitation` are both granted to
 * `authenticated` only, and `accept_invitation` additionally requires the
 * signed-in email to match the invited one. So a signed-out visitor is asked
 * to create an account with the address their landlord used; the token is held
 * in sessionStorage across that round-trip.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, MailCheck, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { RentIDLogo } from "@/components/rentid/Logo";
import { PublicShell } from "@/components/rentid/PublicShell";
import { Button } from "@/components/rentid/kit";
import { Glass } from "@/components/rentid/Surface";
import { useAuth } from "@/lib/auth";
import { useAcceptInvitationToken, useInvitationPreview } from "@/lib/rentid";
import { money } from "@/lib/format";

const PENDING_TOKEN_KEY = "rentid.pending-invitation";

/** Remember the token across the sign-up round-trip. Never throws. */
function rememberToken(token: string) {
  try {
    sessionStorage.setItem(PENDING_TOKEN_KEY, token);
  } catch {
    /* private mode, blocked storage — the link still works, just not after auth */
  }
}

export const Route = createFileRoute("/invite")({
  validateSearch: (search: Record<string, unknown>): { token: string } => ({
    token: typeof search["token"] === "string" ? search["token"] : "",
  }),
  head: () => ({
    meta: [{ title: "Your RentID invitation" }, { name: "robots", content: "noindex" }],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useSearch();
  const { user } = useAuth();
  const navigate = useNavigate();
  const preview = useInvitationPreview(token ?? null);
  const accept = useAcceptInvitationToken();
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (token) rememberToken(token);
  }, [token]);

  if (!token) {
    return (
      <Frame title="That link is incomplete">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          This invitation link is missing its token. Ask your landlord to send it again — the full
          link ends in
          <span className="font-mono"> ?token=…</span>
        </p>
      </Frame>
    );
  }

  if (!user) {
    return (
      <Frame title="You've been invited to RentID">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Your landlord has set up a tenancy for you. Create your RentID account to accept it and
          start building a rent history you can take to your next place.
        </p>
        <p className="mt-3 rounded-2xl border border-border bg-card/60 p-3 text-[12.5px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">
            Use the email address your landlord invited.
          </span>{" "}
          The invitation is tied to that address, and accepting it is what makes the tenancy
          verified for both of you.
        </p>
        <Button className="mt-4 w-full" onClick={() => void navigate({ to: "/auth" })}>
          Create your account <ArrowRight className="size-3.5" />
        </Button>
        <p className="mt-2.5 text-center text-[12px] text-muted-foreground">
          Already have one?{" "}
          <Link to="/auth" className="font-medium text-brand">
            Sign in
          </Link>{" "}
          and open this link again.
        </p>
      </Frame>
    );
  }

  if (preview.isLoading) {
    return (
      <Frame title="Checking your invitation…">
        <div className="h-16 animate-pulse rounded-2xl bg-muted/40" />
      </Frame>
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <Frame title="We couldn't find that invitation">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          The link may have expired, or it may already have been used. Ask your landlord to send a
          fresh one — links are valid for seven days.
        </p>
        <Button
          tone="secondary"
          className="mt-4 w-full"
          onClick={() => void navigate({ to: "/tenant" })}
        >
          Go to my dashboard
        </Button>
      </Frame>
    );
  }

  const inv = preview.data;
  const address = [inv.street_address, inv.city, inv.state].filter(Boolean).join(", ");

  if (accepted || inv.status === "accepted") {
    return (
      <Frame title="You're all set">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          This tenancy is confirmed by both you and {inv.organization_name}. Every rent payment
          recorded from here builds history that belongs to you.
        </p>
        <Button className="mt-4 w-full" onClick={() => void navigate({ to: "/tenant" })}>
          Open my dashboard <ArrowRight className="size-3.5" />
        </Button>
      </Frame>
    );
  }

  if (inv.status !== "pending") {
    return (
      <Frame title="This invitation is no longer active">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Its status is <span className="font-medium text-foreground">{inv.status}</span>. Ask your
          landlord to send a new invitation.
        </p>
      </Frame>
    );
  }

  const emailMismatch =
    user.email && inv.email && user.email.toLowerCase() !== inv.email.toLowerCase();

  return (
    <Frame title={`${inv.organization_name} invited you`}>
      <dl className="space-y-2.5 rounded-2xl border border-border bg-card/60 p-3.5">
        <Row
          label="Home"
          value={[inv.property_name, inv.unit_name].filter(Boolean).join(" · ") || "—"}
        />
        {address ? <Row label="Address" value={address} /> : null}
        {inv.monthly_rent ? <Row label="Monthly rent" value={money(inv.monthly_rent)} /> : null}
        {inv.lease_start ? <Row label="Starts" value={inv.lease_start} /> : null}
        <Row label="Invited" value={inv.email} />
      </dl>

      {emailMismatch ? (
        <p className="mt-3 rounded-2xl border border-warning/40 bg-warning/10 p-3 text-[12.5px] leading-relaxed">
          You're signed in as <span className="font-medium">{user.email}</span>, but this invitation
          was sent to <span className="font-medium">{inv.email}</span>. Sign in with that address to
          accept it.
        </p>
      ) : (
        <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand" />
          Accepting confirms the tenancy from your own account. That two-sided confirmation is what
          makes your rent history verifiable to a future landlord.
        </p>
      )}

      <Button
        className="mt-4 w-full"
        loading={accept.isPending}
        disabled={accept.isPending || Boolean(emailMismatch)}
        onClick={() =>
          accept.mutate(token, {
            onSuccess: () => {
              setAccepted(true);
              toast.success("Tenancy confirmed — welcome home.");
            },
            onError: (err) =>
              toast.error(err instanceof Error ? err.message : "Could not accept the invitation."),
          })
        }
      >
        Accept invitation
      </Button>
    </Frame>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="text-right text-[13px] font-medium">{value}</dd>
    </div>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <PublicShell>
      <div className="flex flex-1 items-center justify-center py-10">
        <Glass className="w-full max-w-md p-6">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-2xl bg-brand/10 text-brand">
              <MailCheck className="size-4" />
            </span>
            <RentIDLogo className="h-5" />
          </div>
          <h1 className="mt-4 font-display text-[19px] font-semibold tracking-tight">{title}</h1>
          <div className="mt-2.5">{children}</div>
        </Glass>
      </div>
    </PublicShell>
  );
}
