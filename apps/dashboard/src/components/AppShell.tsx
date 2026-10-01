"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { getMe } from "../lib/api";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checked, setChecked] = useState(pathname === "/login");

  useEffect(() => {
    if (pathname === "/login") {
      setChecked(true);
      return;
    }
    getMe()
      .then((business) => {
        if (business.status === "onboarding" && pathname !== "/onboarding") {
          router.replace("/onboarding");
          return;
        }
        setChecked(true);
      })
      .catch(() => setChecked(true)); // request() already redirects to /login on 401
  }, [pathname]);

  if (pathname === "/login") return <>{children}</>;
  if (!checked) return null;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar />
      <main className="flex-1 overflow-x-hidden px-4 py-5 md:px-8 md:py-7">{children}</main>
    </div>
  );
}
