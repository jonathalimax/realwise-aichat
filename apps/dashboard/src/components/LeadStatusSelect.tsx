"use client";

import { useState } from "react";
import { updateLeadStatus } from "../lib/api";
import { LEAD_STATUS_OPTIONS } from "../lib/leads";

// Lifecycle status control. "Fechado (vendido/alugado)" is the manual closed-won mark; closed
// leads are kept for future follow-up, never deleted.
export function LeadStatusSelect({
  leadId,
  value,
  onChange,
}: {
  leadId?: string;
  value: string;
  onChange: (status: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleChange(next: string) {
    if (next === value) return;
    setFailed(false);
    if (!leadId) {
      onChange(next);
      return;
    }
    setSaving(true);
    try {
      await updateLeadStatus(leadId, next);
      onChange(next);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        aria-label="Status do interessado"
        value={value}
        disabled={saving}
        onChange={(e) => void handleChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="min-h-9 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-ink disabled:opacity-50"
      >
        {LEAD_STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {failed && <span className="text-xs text-negative">Erro ao salvar</span>}
    </span>
  );
}
