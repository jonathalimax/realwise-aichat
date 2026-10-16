"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { homeFor } from "../../lib/nav";
import { useSession } from "../../lib/session";
import { SECTION_LABELS, type PermissionSection } from "@realwise/shared";

/** "Sem acesso" page: rendered for a route the member's role cannot open and for any 403 on page load. */
export function NoAccess({ section }: { section?: PermissionSection | null }) {
  const { me, niche } = useSession();
  const sectionName = section ? SECTION_LABELS[section] : null;
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <Card className="w-full max-w-[480px]">
        <CardContent className="flex flex-col items-center gap-3.5 px-8 py-10 text-center">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-amber-100 text-amber-800">
            <Lock className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-ink">
            {sectionName ? `Você não tem acesso a ${sectionName}` : "Você não tem acesso a esta área"}
          </h1>
          <p className="text-sm text-muted">
            {me ? (
              <>
                Sua função atual é <b className="text-ink">{me.role.name}</b>. Essa seção não está liberada para ela.
              </>
            ) : (
              "Essa seção não está liberada para a sua função."
            )}{" "}
            Peça a um proprietário ou gerente para ajustar o seu acesso em Equipe e acessos.
          </p>
          <Link href={homeFor(niche, me)} className={cn(buttonVariants(), "mt-2")}>
            Voltar ao início
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
