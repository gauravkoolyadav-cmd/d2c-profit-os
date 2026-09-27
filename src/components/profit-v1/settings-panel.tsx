"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Settings {
  googleSheetId: string | null;
  configRange: string;
  mappingRange: string | null;
  defaultProductGstPercent: number;
  timezone: string;
}

export function SyncButtons({ brandId, onDone }: { brandId: string; onDone: () => void }) {
  const [running, setRunning] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (source: "sheet" | "meta" | "shopify") => {
    setRunning(source);
    setMessage(null);
    try {
      const res = await fetch(`/api/brands/${brandId}/profit-dashboard/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const json = await res.json();
      setMessage({ ok: res.ok && json.ok !== false, text: json.message ?? json.error ?? "Done" });
      onDone();
    } catch {
      setMessage({ ok: false, text: "Sync request failed" });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={running !== null} onClick={() => run("sheet")}>
        {running === "sheet" ? "Syncing…" : "Sync Google Sheet"}
      </Button>
      <Button size="sm" variant="outline" disabled={running !== null} onClick={() => run("meta")}>
        {running === "meta" ? "Syncing…" : "Sync Meta spend"}
      </Button>
      <Button size="sm" variant="outline" disabled={running !== null} onClick={() => run("shopify")}>
        {running === "shopify" ? "Syncing…" : "Re-import Shopify orders"}
      </Button>
      {message && <span className={message.ok ? "text-xs text-emerald-700" : "text-xs text-red-600"}>{message.text}</span>}
    </div>
  );
}

export function SettingsPanel({ brandId, canEdit, onSaved }: { brandId: string; canEdit: boolean; onSaved: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/brands/${brandId}/profit-dashboard/settings`)
      .then((r) => r.json())
      .then((json) => setSettings(json.settings ?? null))
      .catch(() => setStatus("Could not load settings"));
  }, [brandId]);

  if (!settings) return <p className="text-sm text-muted-foreground">{status ?? "Loading settings…"}</p>;

  const save = async () => {
    setStatus("Saving…");
    const res = await fetch(`/api/brands/${brandId}/profit-dashboard/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        googleSheetId: settings.googleSheetId ?? "",
        configRange: settings.configRange,
        mappingRange: settings.mappingRange ?? "",
        defaultProductGstPercent: Number(settings.defaultProductGstPercent),
        timezone: settings.timezone,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setStatus("Saved");
      onSaved();
    } else {
      const fieldErrors = json?.details?.fieldErrors ? Object.values(json.details.fieldErrors).flat().join(", ") : "";
      setStatus(fieldErrors || json.error || "Could not save");
    }
  };

  const field = (label: string, hint: string, input: React.ReactNode) => (
    <label className="space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {input}
      <span className="block text-xs text-muted-foreground">{hint}</span>
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {field(
          "Google Sheet (URL or ID)",
          "Share the sheet with the service account email as Viewer.",
          <Input disabled={!canEdit} value={settings.googleSheetId ?? ""} onChange={(e) => setSettings({ ...settings, googleSheetId: e.target.value })} />
        )}
        {field(
          "Config tab range",
          "One row per shoe; first row = headers.",
          <Input disabled={!canEdit} value={settings.configRange} onChange={(e) => setSettings({ ...settings, configRange: e.target.value })} />
        )}
        {field(
          "Mapping tab range (optional)",
          "Columns: Shopify Product Name | Shoe Name. Leave empty if not needed.",
          <Input disabled={!canEdit} value={settings.mappingRange ?? ""} onChange={(e) => setSettings({ ...settings, mappingRange: e.target.value })} />
        )}
        {field(
          "Default product GST %",
          "Used when a shoe row has no GST % column. Sheet prices include GST; revenue is shown ex-GST. 0 = no GST removed.",
          <Input
            disabled={!canEdit}
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={settings.defaultProductGstPercent}
            onChange={(e) => setSettings({ ...settings, defaultProductGstPercent: Number(e.target.value) })}
          />
        )}
        {field(
          "Timezone",
          "Decides which day an order belongs to.",
          <Input disabled={!canEdit} value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} />
        )}
      </div>
      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save}>
            Save settings
          </Button>
          {status && <span className="text-xs text-muted-foreground">{status}</span>}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only managers and owners can change settings.</p>
      )}
    </div>
  );
}
