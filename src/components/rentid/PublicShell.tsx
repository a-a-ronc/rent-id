import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState, type ReactNode } from "react";

import { RentIDLogo } from "@/components/rentid/Logo";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** Public marketing / marketplace chrome shared by every signed-out page. */
const PUBLIC_NAV = [
  { to: "/rent", label: "Find a rental" },
  { to: "/for-tenants", label: "For tenants" },
  { to: "/for-landlords", label: "For landlords" },
  { to: "/for-property-managers", label: "For property managers" },
  { to: "/join", label: "Join RentID" },
];

export function PublicShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-80 w-[42rem] -translate-x-1/2 rounded-full bg-accent/25 blur-3xl" />
        <div className="absolute top-1/2 -left-24 size-72 rounded-full bg-brand/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 sm:px-8">
        <header className="flex items-center justify-between gap-3 py-6">
          <Link to="/">
            <RentIDLogo markClassName="size-8" wordmarkClassName="text-[20px]" />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {PUBLIC_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-full px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="glass rounded-full px-4 py-2 text-[13px] font-medium transition-opacity hover:opacity-90"
            >
              Sign in
            </Link>
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger
                aria-label="Open menu"
                className="glass grid size-9 place-items-center rounded-full lg:hidden"
              >
                <Menu className="size-4" strokeWidth={1.75} />
              </SheetTrigger>
              <SheetContent
                side="bottom"
                className="rounded-t-3xl border-none bg-background px-5 pb-8"
              >
                <SheetTitle className="font-display text-base">RentID</SheetTitle>
                <div className="mt-4 grid gap-2">
                  {PUBLIC_NAV.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setOpen(false)}
                      className="glass rounded-2xl px-4 py-3 text-[13.5px] font-medium"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="mt-10 border-t border-border/60 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="label-eyebrow">© 2026 RentID</p>
            <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              <Link to="/for-tenants" className="hover:text-foreground">
                Tenants
              </Link>
              <Link to="/for-landlords" className="hover:text-foreground">
                Landlords
              </Link>
              <Link to="/for-property-managers" className="hover:text-foreground">
                Property managers
              </Link>
              <span>Payments and credit reporting coming soon.</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** Simple marketing hero used by the role landing pages. */
export function PublicHero({
  eyebrow,
  title,
  body,
  primary,
  secondary,
}: {
  eyebrow: string;
  title: ReactNode;
  body: string;
  primary: { to: string; label: string };
  secondary?: { to: string; label: string };
}) {
  return (
    <section className="pt-6 pb-12 sm:pt-12">
      <p className="label-eyebrow">{eyebrow}</p>
      <h1 className="mt-3 max-w-2xl font-display text-[34px] leading-[1.06] font-bold tracking-tight sm:text-5xl">
        {title}
      </h1>
      <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Link
          to={primary.to}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-[14px] font-semibold text-brand-foreground transition-opacity hover:opacity-90"
        >
          {primary.label}
        </Link>
        {secondary ? (
          <Link
            to={secondary.to}
            className="glass rounded-full px-6 py-3 text-[14px] font-medium transition-opacity hover:opacity-90"
          >
            {secondary.label}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/** Feature / step grid for marketing pages. */
export function PublicGrid({
  items,
  columns = 2,
}: {
  items: { title: string; body: string }[];
  columns?: 2 | 3;
}) {
  return (
    <div className={columns === 3 ? "grid gap-3 sm:grid-cols-3" : "grid gap-3 sm:grid-cols-2"}>
      {items.map((item, i) => (
        <div
          key={item.title}
          className="glass rounded-2xl p-5"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <h3 className="font-display text-[15px] font-semibold tracking-tight">{item.title}</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{item.body}</p>
        </div>
      ))}
    </div>
  );
}
