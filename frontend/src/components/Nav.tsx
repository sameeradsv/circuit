"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCircuitAuth } from "@/lib/use-circuit-auth";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/tasks", label: "Tasks" },
];

export function Nav() {
  const pathname = usePathname();
  const { user } = useCircuitAuth();

  return (
    <nav className="border-b border-circuit-border bg-circuit-surface px-4 py-3">
      <div className="mx-auto flex max-w-4xl items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold tracking-wide text-circuit-accent">
            Circuit
          </span>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-sm ${
                pathname === l.href
                  ? "text-circuit-text"
                  : "text-circuit-muted hover:text-circuit-text"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <Link
              href="/account"
              className="text-xs text-circuit-muted hover:text-circuit-text"
            >
              {user.username}
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-xs text-circuit-muted hover:text-circuit-text"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
