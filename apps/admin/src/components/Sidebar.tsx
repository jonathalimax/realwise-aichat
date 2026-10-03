"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, LogOut } from "lucide-react";
import { Sheet, SheetTrigger, SheetContent } from "./ui/sheet";
import { logout } from "../lib/api";

const ITEMS = [
  { href: "/", label: "Clientes" },
  { href: "/conversations", label: "Conversas" },
  { href: "/settings", label: "Configurações" },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();

  async function handleLogout() {
    onNavigate?.();
    await logout().catch(() => {});
    router.push("/login");
  }

  return (
    <nav className="flex flex-1 flex-col gap-1 text-sm text-ink-soft">
      {ITEMS.map((item) => (
        <Link key={item.href} href={item.href} onClick={onNavigate} className="rounded-lg px-3 py-2 hover:bg-surface">
          {item.label}
        </Link>
      ))}
      <button onClick={handleLogout} className="mt-auto flex items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-surface">
        <LogOut className="h-4 w-4" /> Sair
      </button>
    </nav>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="flex items-center gap-3 border-b border-border bg-bg-2 px-4 py-3 md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button className="rounded-lg p-1.5 text-ink-soft hover:bg-surface" aria-label="Abrir menu">
              <Menu className="h-6 w-6" />
            </button>
          </SheetTrigger>
          <SheetContent>
            <div className="flex h-full flex-col px-6 py-6">
              <div className="mb-6 font-serif text-lg font-bold text-ink">Realwise · Admin</div>
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
        <span className="font-serif text-lg font-bold text-ink">Realwise · Admin</span>
      </header>

      <aside className="hidden w-56 flex-none border-r border-border bg-bg-2 px-4 py-6 md:flex md:flex-col">
        <div className="mb-6 px-2 font-serif text-lg font-bold text-ink">Realwise · Admin</div>
        <NavLinks />
      </aside>
    </>
  );
}
