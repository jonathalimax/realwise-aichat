"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { LogOut, Menu, Plus } from "lucide-react";
import { Sheet, SheetTrigger, SheetContent } from "../ui/sheet";
import { Avatar, initialsOf } from "../ui/avatar";
import { logout } from "../../lib/api";
import { visibleNav, type NavItem } from "../../lib/nav";
import { useSession } from "../../lib/session";
import { cn } from "../../lib/utils";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  const { me, business, niche } = useSession();
  const name = me?.business.name ?? business?.name ?? "Realwise";
  const logo = me?.business.logoUrl ?? null;
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="h-9 w-9 flex-none rounded-[9px] object-cover" />
      ) : (
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px] bg-accent text-white" aria-hidden>
          {niche === "farmacia" ? <Plus className="h-5 w-5" strokeWidth={2.4} /> : <span className="font-bold">{name.slice(0, 1).toUpperCase()}</span>}
        </span>
      )}
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-bold text-ink">{name}</span>
        <span className="truncate text-xs text-muted">{me?.role.name ?? (niche === "farmacia" ? "Painel da farmácia" : "Painel")}</span>
      </div>
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { me, niche, notifications } = useSession();
  const groups = visibleNav(niche, me);

  const badgeFor = (item: NavItem): number => {
    if (item.badge === "pedidos") return (notifications?.orders?.new ?? 0) + (notifications?.prescriptions?.pending ?? 0);
    if (item.badge === "atendimento") return notifications?.handoffs?.open ?? 0;
    return 0;
  };

  async function handleLogout() {
    onNavigate?.();
    await logout().catch(() => {});
    router.push("/login");
  }

  return (
    <>
      <nav aria-label="Principal" className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {groups.map((g, gi) => (
          <div key={g.label ?? gi} className="flex flex-col gap-0.5">
            {g.label && <div className="px-2 py-1 text-xs font-medium text-muted">{g.label}</div>}
            {g.items.map((item) => {
              const active = isActive(pathname, item.href);
              const count = badgeFor(item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-9 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
                    active ? "bg-brand-soft text-brand-2" : "text-ink-soft hover:bg-bg-2",
                  )}
                >
                  <Icon className="h-[18px] w-[18px] flex-none" strokeWidth={1.8} aria-hidden />
                  <span className="flex-1 leading-tight">{item.label}</span>
                  {count > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-white">
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-2.5 border-t border-border pt-3">
        <Avatar initials={initialsOf(me?.member.name ?? "")} />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-semibold text-ink">{me?.member.name ?? "Você"}</span>
          <span className="truncate text-xs text-muted">{me?.role.name ?? ""}</span>
        </div>
        <button onClick={handleLogout} aria-label="Sair" className="rounded-lg p-1.5 text-muted hover:bg-bg-2 hover:text-ink">
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Mobile top bar */}
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3 md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button className="rounded-lg p-1.5 text-ink-soft hover:bg-bg-2" aria-label="Abrir menu">
              <Menu className="h-6 w-6" />
            </button>
          </SheetTrigger>
          <SheetContent className="w-[280px]">
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            <div className="flex h-full flex-col gap-4 px-3 py-4">
              <Brand />
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
        <div className="min-w-0 flex-1">
          <Brand />
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[260px] flex-none flex-col gap-4 border-r border-border bg-surface px-3 py-4 md:flex">
        <Brand />
        <NavLinks />
      </aside>
    </>
  );
}
