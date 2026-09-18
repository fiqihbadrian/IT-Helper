"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, RefreshCw, Send } from "lucide-react";

import { generateTelegramLinkCode } from "@/app/actions/telegram";
import { Alert } from "@/components/ui/Field";
import { Card, CardHeader } from "@/components/ui/Card";

export function TelegramPanel({
  botUsername,
  linked,
  linkedChatId,
  configured,
}: {
  botUsername: string | null;
  linked: boolean;
  linkedChatId: number | null;
  configured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function generate() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await generateTelegramLinkCode();
      if (!result.ok) {
        setError(result.error ?? "Gagal membuat kode.");
        return;
      }
      setCode(result.data?.code ?? null);
      setExpiresAt(result.data?.expiresAt ?? null);
      router.refresh();
    });
  }

  async function copy() {
    if (!code) return;
    await navigator.clipboard.writeText(`/start ${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader
        title="Telegram"
        description="Buat dan pantau tiket langsung dari Telegram, tanpa membuka browser."
        action={
          linked ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-success-ink">
              <span data-tone="resolved" className="tone-dot h-1.5 w-1.5 rounded-full" />
              Terhubung
            </span>
          ) : (
            <span className="text-[13px] text-ink-muted">Belum terhubung</span>
          )
        }
      />

      <div className="space-y-4 px-5 py-4">
        {error ? <Alert>{error}</Alert> : null}

        {!configured ? (
          <Alert tone="warning">
            <p className="font-medium">Bot belum dikonfigurasi.</p>
            <p className="mt-1">
              Isi <span className="font-mono">TELEGRAM_BOT_TOKEN</span> (atau{" "}
              <span className="font-mono">BOT_TELE</span>) di{" "}
              <span className="font-mono">.env.local</span>, lalu restart server.
            </p>
          </Alert>
        ) : null}

        {linked ? (
          <>
            <p className="text-[13px] text-ink-muted">
              Akun Telegram kamu sudah terhubung
              {linkedChatId ? (
                <>
                  {" "}
                  (chat <span className="font-mono">{linkedChatId}</span>)
                </>
              ) : null}
              . Notifikasi tiket dikirim ke sana.
            </p>

            <div className="rounded-md border border-surface-border bg-surface-muted/50 px-3.5 py-3 text-[13px] text-ink-muted">
              <p className="font-medium text-ink">Perintah yang tersedia</p>
              <ul className="mt-2 space-y-1">
                <li>
                  <span className="font-mono text-ink">/new</span> — buat tiket baru, bisa
                  sekalian kirim screenshot
                </li>
                <li>
                  <span className="font-mono text-ink">/tickets</span> — daftar tiket kamu
                </li>
                <li>
                  <span className="font-mono text-ink">/ticket IT-000004</span> — detail satu
                  tiket
                </li>
                <li>
                  <span className="font-mono text-ink">/unlink</span> — putuskan akun
                </li>
              </ul>
            </div>
          </>
        ) : (
          <>
            <ol className="space-y-2 text-[13px] text-ink-muted">
              <li>
                1. Buka{" "}
                {botUsername ? (
                  <a
                    href={`https://t.me/${botUsername}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-accent hover:underline"
                  >
                    @{botUsername}
                  </a>
                ) : (
                  <span className="font-mono">bot Telegram</span>
                )}{" "}
                di Telegram.
              </li>
              <li>2. Tekan Start.</li>
              <li>3. Buat kode di bawah, lalu kirim ke bot.</li>
            </ol>

            {code ? (
              <div className="rounded-md border border-accent/30 bg-accent-soft px-3.5 py-3">
                <p className="text-xs text-ink-muted">Kirim pesan ini ke bot:</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="flex-1 font-mono text-sm font-semibold text-ink">
                    /start {code}
                  </code>
                  <button type="button" className="btn-secondary px-2.5 py-1.5" onClick={copy}>
                    {copied ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied ? "Tersalin" : "Salin"}
                  </button>
                </div>
                {expiresAt ? (
                  <p className="mt-2 text-xs text-ink-subtle">
                    Berlaku sampai{" "}
                    {new Date(expiresAt).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    .
                  </p>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              className="btn-primary"
              disabled={pending || !configured}
              onClick={generate}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : code ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {code ? "Buat kode baru" : "Hubungkan Telegram"}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}
