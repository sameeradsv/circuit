"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/",         label: "Now",   glyph: "•" },
  { href: "/add",      label: "Add",   glyph: "+" },
  { href: "/tasks",    label: "Tasks", glyph: "≡" },
  { href: "/calendar", label: "Cal",   glyph: "▦" },
];

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="tabbar">
      {TABS.map((t) => {
        const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={"tabitem" + (active ? " is-active" : "")}
          >
            <span className="tabglyph">{t.glyph}</span>
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
