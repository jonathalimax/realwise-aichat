import Link from "next/link";

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

export function Sidebar() {
  return (
    <aside className="w-56 flex-none border-r border-border bg-bg-2 px-4 py-6">
      <div className="mb-6 px-2 font-serif text-lg font-bold text-ink">Realwise</div>
      <nav className="flex flex-col gap-1">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-surface"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
