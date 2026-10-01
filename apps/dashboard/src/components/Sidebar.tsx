"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Sheet, SheetTrigger, SheetContent } from "./ui/sheet";

const ITEMS = [
  { href: "/", label: "Início" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/leads", label: "Leads" },
  { href: "/agenda", label: "Agenda" },
  { href: "/knowledge", label: "Base de conhecimento" },
  { href: "/analytics", label: "Análises" },
  { href: "/billing", label: "Plano e cobrança" },
  { href: "/settings", label: "Personalização" },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          className="rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-surface"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <header className="flex items-center gap-3 border-b border-border bg-bg-2 px-4 py-3 md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button className="rounded-lg p-1.5 text-ink-soft hover:bg-surface" aria-label="Abrir menu">
              <Menu className="h-6 w-6" />
            </button>
          </SheetTrigger>
          <SheetContent>
            <div className="px-6 py-6">
              <div className="mb-6 font-serif text-lg font-bold text-ink">Realwise</div>
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
        <span className="font-serif text-lg font-bold text-ink">Realwise</span>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden w-56 flex-none border-r border-border bg-bg-2 px-4 py-6 md:flex md:flex-col">
        <div className="mb-6 px-2 font-serif text-lg font-bold text-ink">Realwise</div>
        <NavLinks />
      </aside>
    </>
  );
}
