import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ChunkErrorReload } from "../components/ChunkErrorReload";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

// The icon is a public file requested under the assetPrefix (/_c), so it never collides with the marketing app's /icon.svg.
export const metadata: Metadata = { icons: { icon: "/_c/icon.svg" } };

// Without this, Next.js App Router emits no viewport meta tag, leaving mobile
// browsers to pick their own default scale — this is what caused the chat to
// render zoomed-in and cut off on mobile. We pin initial scale to 1 but keep
// pinch-zoom enabled (no maximumScale/userScalable lock) for accessibility.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={sans.variable}>
      <body className="font-sans">
        <ChunkErrorReload />
        {children}
      </body>
    </html>
  );
}
