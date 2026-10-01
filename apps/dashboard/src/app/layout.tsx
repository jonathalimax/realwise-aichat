import "./globals.css";
import { Sidebar } from "../components/Sidebar";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="flex min-h-dvh">
        <Sidebar />
        <main className="flex-1 px-8 py-7">{children}</main>
      </body>
    </html>
  );
}
