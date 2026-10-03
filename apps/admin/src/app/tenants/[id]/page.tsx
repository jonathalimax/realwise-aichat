"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getTenantDetail, getTenantKnowledge, suspendTenant } from "../../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../../components/ui/card";
import { Badge, statusToBadgeVariant } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { StatCard } from "../../../components/ui/stat-card";
import { SegmentedControl } from "../../../components/ui/segmented";
import { ConfidenceBreakdownChart } from "../../../components/charts/ConfidenceBreakdownChart";
import { ProfileFieldsSection } from "../../../components/tenant/ProfileFieldsSection";
import { KnowledgeBaseSection } from "../../../components/tenant/KnowledgeBaseSection";
import { ListingsSection } from "../../../components/tenant/ListingsSection";

const SECTION_OPTIONS = [
  { label: "Perfil do negócio", value: "profile" },
  { label: "Base de conhecimento", value: "knowledge" },
  { label: "Catálogo de anúncios", value: "listings" },
] as const;

// Light-traffic costs are often sub-cent — fixed .toFixed(2) would show "$0.00" for real non-zero usage.
function formatCostUsd(value: number): string {
  return value > 0 && value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const [tenant, setTenant] = useState<any>(null);
  const [knowledge, setKnowledge] = useState<any>(null);
  const [section, setSection] = useState<(typeof SECTION_OPTIONS)[number]["value"]>("profile");

  useEffect(() => {
    getTenantDetail(params.id).then(setTenant).catch(() => {});
  }, [params.id]);

  useEffect(() => {
    getTenantKnowledge(params.id).then(setKnowledge).catch(() => {});
  }, [params.id]);

  if (!tenant) return <p className="text-ink-soft">Carregando…</p>;

  const breakdown = tenant.confidenceBreakdown ?? {};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="break-words font-serif text-2xl text-ink">{tenant.name || tenant.slug}</h1>
          <Badge variant={statusToBadgeVariant(tenant.status)}>{tenant.status}</Badge>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => suspendTenant(tenant.id).then(() => location.reload())}
        >
          Suspender
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Nicho" value={tenant.niche} />
        <StatCard label="Confiança" value={`${tenant.confidenceScore}%`} />
        <StatCard label="Plano" value={tenant.subscription?.plan?.name ?? "Sem assinatura"} />
        <StatCard
          label="Site sincronizado"
          value={tenant.websiteSyncedAt ? new Date(tenant.websiteSyncedAt).toLocaleDateString("pt-BR") : "—"}
        />
        <StatCard
          label="Custo estimado (7d)"
          value={formatCostUsd(tenant.costUsd7d ?? 0)}
          context={`${(tenant.tokensUsed7d ?? 0).toLocaleString("pt-BR")} tokens`}
        />
      </div>

      {Object.keys(breakdown).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Composição da confiança</CardTitle>
            <CardDescription>Como cada componente contribui para o score de prontidão.</CardDescription>
          </CardHeader>
          <CardContent>
            <ConfidenceBreakdownChart breakdown={breakdown} />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl value={section} onValueChange={setSection} options={SECTION_OPTIONS} />
      </div>

      <Card>
        <CardContent className="pt-4 sm:pt-6">
          {section === "profile" && (
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Dados cadastrais</div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <div className="text-ink-soft">Slug</div>
                    <div className="break-words text-ink">{tenant.slug ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Telefone</div>
                    <div className="break-words text-ink">{tenant.phone ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Dono</div>
                    <div className="break-words text-ink">{tenant.ownerName ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-ink-soft">E-mail</div>
                    <div className="break-words text-ink">{tenant.email ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Endereço</div>
                    <div className="break-words text-ink">{tenant.address ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Site</div>
                    <div className="break-words text-ink">{tenant.websiteUrl ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Fuso horário</div>
                    <div className="break-words text-ink">{tenant.timezone ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Fim do trial</div>
                    <div className="break-words text-ink">
                      {tenant.trialEndsAt ? new Date(tenant.trialEndsAt).toLocaleString("pt-BR") : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Publicado em</div>
                    <div className="break-words text-ink">
                      {tenant.publishedAt ? new Date(tenant.publishedAt).toLocaleString("pt-BR") : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Criado em</div>
                    <div className="break-words text-ink">
                      {tenant.createdAt ? new Date(tenant.createdAt).toLocaleString("pt-BR") : "—"}
                    </div>
                  </div>
                </div>
              </div>
              <ProfileFieldsSection profile={knowledge?.profile ?? null} />
            </div>
          )}
          {section === "knowledge" &&
            (knowledge ? (
              <KnowledgeBaseSection
                tenantId={tenant.id}
                documents={knowledge.documents}
                chunkTotal={knowledge.chunkTotal}
                chunkSample={knowledge.chunkSample}
              />
            ) : (
              <p className="text-ink-soft">Carregando…</p>
            ))}
          {section === "listings" && <ListingsSection tenantId={tenant.id} />}
        </CardContent>
      </Card>
    </div>
  );
}
