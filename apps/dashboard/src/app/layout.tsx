import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Sidebar } from "../components/Sidebar";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={sans.variable}>
      <body className="flex min-h-dvh font-sans">
        <Sidebar />
        <main className="flex-1 px-8 py-7">{children}</main>
      </body>
    </html>
  );
}
