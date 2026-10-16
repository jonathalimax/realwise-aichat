"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PERMISSION_SECTIONS, type PermissionSection } from "@realwise/shared";
import { NoAccess } from "../../components/shell/NoAccess";

export default function NoAccessPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const raw = useSearchParams().get("section");
  const section = (PERMISSION_SECTIONS as readonly string[]).includes(raw ?? "") ? (raw as PermissionSection) : null;
  return <NoAccess section={section} />;
}
