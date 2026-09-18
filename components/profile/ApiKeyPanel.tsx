"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";

import { createUserApiKey, revokeUserApiKey } from "@/app/actions/telegram";
import { Alert } from "@/components/ui/Field";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatDate, formatRelative } from "@/lib/utils";
import type { ApiKeyRow } from "@/services/telegram";

export function ApiKeyPanel({ keys }: { keys: ApiKeyRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const active = keys.filter((key) => !key.revoked_at);

  function create() {
    setError(null);
    setCopied(false);
    const formData = new FormData();
    formData.set("name", name.trim() || "Tanpa nama");

    startTransition(async () => {
      const result = await createUserApiKey(formData);
      if (!result.ok) {
        setError(result.error ?? "Gagal membuat API key.");
        return;
      }
      setSecret(result.data?.apiKey ?? null);
      setName("");
      router.refresh();
    });
  }

  function revoke(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokeUserApiKey(id);
      if (!result.ok) setError(result.error ?? "Gagal mencabut key.");
      router.refresh();
    });
  }

  async function copy() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader
        title="API Keys"
        description="Untuk script, cron job, atau AI tool. Key berlaku sebagai akun kamu, jadi aksesnya sama persis dengan yang kamu lihat di web."
        action={
          <span className="text-[13px] text-ink-muted">
            {active.length} aktif
          </span>
        }
      />

      <div className="space-y-4 px-5 py-4">
        {error ? <Alert>{error}</Alert> : null}

        {secret ? (
          <Alert tone="warning">
            <p className="font-medium">Simpan key ini sekarang.</p>
            <p className="mt-1">
              Hanya ditampilkan sekali. Yang tersimpan di database hanya hash-nya.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1.5 font-mono text-xs">
                {secret}
              </code>
              <button type="button" className="btn-secondary px-2.5 py-1.5" onClick={copy}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Tersalin" : "Salin"}
              </button>
            </div>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1">
            <label htmlFor="key-name" className="mb-1.5 block text-[13px] font-medium text-ink">
              Nama key
            </label>
            <input
              id="key-name"
              className="input"
              placeholder="mis. n8n automation"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <button type="button" className="btn-primary" disabled={pending} onClick={create}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Buat key
          </button>
        </div>

        {keys.length ? (
          <ul className="divide-y divide-surface-border border-t border-surface-border">
            {keys.map((key) => (
              <li key={key.id} className="flex items-center gap-3 py-3">
                <KeyRound className="h-4 w-4 shrink-0 text-ink-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                    <span className="font-medium text-ink">{key.name}</span>
                    <code className="font-mono text-xs text-ink-muted">
                      {key.key_prefix}…
                    </code>
                    {key.revoked_at ? (
                      <span className="text-xs text-danger-ink">dicabut</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    Dibuat {formatDate(key.created_at)}
                    {key.last_used_at
                      ? ` · terakhir dipakai ${formatRelative(key.last_used_at)}`
                      : " · belum pernah dipakai"}
                  </p>
                </div>

                {!key.revoked_at ? (
                  <button
                    type="button"
                    className="btn-ghost px-2 py-1.5 text-[13px] text-danger-ink hover:bg-danger-soft"
                    disabled={pending}
                    onClick={() => revoke(key.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Cabut
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-surface-border pt-3 text-[13px] text-ink-muted">
            Belum ada API key.
          </p>
        )}
      </div>
    </Card>
  );
}
