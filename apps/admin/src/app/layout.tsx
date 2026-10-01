import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="flex min-h-dvh">
        <aside className="w-56 flex-none border-r border-border bg-bg-2 px-4 py-6">
          <div className="mb-6 px-2 font-serif text-lg font-bold text-ink">Realwise · Admin</div>
          <nav className="flex flex-col gap-1 text-sm text-ink-soft">
            <a href="/" className="rounded-lg px-3 py-2 hover:bg-surface">Tenants</a>
          </nav>
        </aside>
        <main className="flex-1 px-8 py-7">{children}</main>
      </body>
    </html>
  );
}
