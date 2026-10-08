import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AppShell } from "../components/AppShell";
import { ChunkErrorReload } from "../components/ChunkErrorReload";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`dark ${sans.variable}`} suppressHydrationWarning>
      <body className="font-sans">
        <ChunkErrorReload />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
