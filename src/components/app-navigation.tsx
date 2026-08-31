"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function NavIcon({ kind }: { kind: "leads" | "admin" }) {
  return kind === "leads" ? (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M8 7.5a4 4 0 1 1 8 0 4 4 0 0 1-8 0ZM5 20a7 7 0 0 1 14 0" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  ) : (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M12 2.75v2M12 19.25v2M21.25 12h-2M4.75 12h-2M18.54 5.46l-1.42 1.42M6.88 17.12l-1.42 1.42M18.54 18.54l-1.42-1.42M6.88 6.88 5.46 5.46" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="5.25" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="1.75" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function AppNavigation({
  adminLabel,
  isAdmin,
  leadsLabel,
  navigationLabel,
  mobile = false,
}: {
  adminLabel: string;
  isAdmin: boolean;
  leadsLabel: string;
  navigationLabel: string;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const links = [
    { href: "/leads", label: leadsLabel, kind: "leads" as const, visible: true },
    { href: "/admin", label: adminLabel, kind: "admin" as const, visible: isAdmin },
  ];

  return (
    <nav aria-label={navigationLabel} className={mobile ? "flex min-w-0 gap-1" : "space-y-1"}>
      {links.filter((link) => link.visible).map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-xl text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
              mobile ? "px-3 py-2" : "px-3.5 py-3"
            } ${
              active
                ? "bg-emerald-400/12 text-emerald-200 ring-1 ring-inset ring-emerald-400/20"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            }`}
            href={link.href}
            key={link.href}
          >
            <NavIcon kind={link.kind} />
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
