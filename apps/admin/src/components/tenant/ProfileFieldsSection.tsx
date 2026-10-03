import { Badge } from "../ui/badge";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

function formatValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function ProfileFieldsSection({ profile }: { profile: any }) {
  if (!profile) {
    return <p className="text-ink-soft">Perfil ainda não iniciado.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <div className="text-ink-soft">Versão do template</div>
          <div className="break-words text-ink">{profile.templateVersion ?? "—"}</div>
        </div>
        <div>
          <div className="text-ink-soft">Aprovado em</div>
          <div className="break-words text-ink">{formatDate(profile.approvedAt)}</div>
        </div>
        <div>
          <div className="text-ink-soft">Atualizado em</div>
          <div className="break-words text-ink">{formatDate(profile.updatedAt)}</div>
        </div>
        <div>
          <div className="text-ink-soft">Tokens do resumo</div>
          <div className="break-words text-ink">{profile.cachedSummaryTokens ?? "—"}</div>
        </div>
      </div>

      {profile.cachedSummary && (
        <details className="rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">Resumo em cache</summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-ink-soft">{profile.cachedSummary}</p>
        </details>
      )}

      {profile.customInstructions && (
        <details className="rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">Instruções personalizadas</summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-ink-soft">{profile.customInstructions}</p>
        </details>
      )}

      <div className="flex flex-col gap-2">
        {profile.fields.map((field: any) => {
          const displayValue = formatValue(field.value);
          return (
            <div
              key={field.key}
              className="flex flex-col gap-2 rounded-lg border border-border bg-bg-2 px-3 py-3 text-sm"
            >
              <div className="font-semibold text-ink">{field.question ?? field.label}</div>
              {displayValue ? (
                <p className="whitespace-pre-wrap break-words text-ink">{displayValue}</p>
              ) : (
                <span className="text-ink-soft">Sem valor preenchido</span>
              )}
              <div className="flex flex-wrap gap-2">
                <Badge variant="neutral">{field.weight}</Badge>
                <Badge variant={field.approvedByOwner ? "positive" : "warning"}>
                  {field.approvedByOwner ? "Aprovado pelo dono" : "Não aprovado"}
                </Badge>
                {field.source && <Badge variant="accent">{field.source}</Badge>}
                <Badge variant="neutral">{field.key}</Badge>
              </div>
            </div>
          );
        })}
      </div>

      {profile.orphanData && Object.keys(profile.orphanData).length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Dados sem campo correspondente no template
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-bg-2 p-3 text-xs text-ink-soft">
            {JSON.stringify(profile.orphanData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
