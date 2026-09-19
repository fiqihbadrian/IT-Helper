"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, RefreshCw, Send } from "lucide-react";

import { generateTelegramLinkCode } from "@/app/actions/telegram";
import { Alert } from "@/components/ui/Field";
import { Card, CardHeader } from "@/components/ui/Card";
import { BOT_META, BOT_TOKEN_VARS, type BotKind } from "@/lib/telegram/bots";

/**
 * One card per bot.
 *
 * The two bots are separate conversations with separate menus, so they get
 * separate cards rather than one card with a mode switch: linking the staff bot
 * is a different act from linking the employee bot, and a person can legitimately
 * have one and not the other.
 */
export function TelegramPanel({
  bot,
  botUsername,
  commands,
  linked,
  linkedChatId,
  configured,
  allowed,
}: {
  bot: BotKind;
  botUsername: string | null;
  commands: Array<{ command: string; description: string }>;
  linked: boolean;
  linkedChatId: number | null;
  configured: boolean;
  /** False for an employee looking at the staff bot. */
  allowed: boolean;
}) {
  const router = useRouter();
  const meta = BOT_META[bot];

  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function generate() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await generateTelegramLinkCode(bot);
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
        title={meta.label}
        description={meta.purpose}
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

        {!allowed ? (
          <Alert tone="warning">
            <p className="font-medium">Hanya untuk tim IT.</p>
            <p className="mt-1">
              Bot ini membawa antrean tiket seluruh perusahaan, jadi hanya akun{" "}
              <span className="font-mono">it_support</span> dan{" "}
              <span className="font-mono">admin</span> yang bisa menghubungkannya.
            </p>
          </Alert>
        ) : null}

        {allowed && !configured ? (
          <Alert tone="warning">
            <p className="font-medium">Bot belum dikonfigurasi.</p>
            <p className="mt-1">
              Isi <span className="font-mono">{BOT_TOKEN_VARS[bot][0]}</span> (atau{" "}
              <span className="font-mono">{BOT_TOKEN_VARS[bot][1]}</span>) di{" "}
              <span className="font-mono">.env.local</span>, lalu restart server.
            </p>
          </Alert>
        ) : null}

        {allowed ? (
          <>
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
                  .{" "}
                  {bot === "staff"
                    ? "Notifikasi tiket tim IT dikirim ke sana."
                    : "Notifikasi tiketmu dikirim ke sana."}
                </p>

                <div className="rounded-md border border-surface-border bg-surface-muted/50 px-3.5 py-3 text-[13px] text-ink-muted">
                  <p className="font-medium text-ink">Perintah yang tersedia</p>
                  <ul className="mt-2 space-y-1">
                    {commands.map((item) => (
                      <li key={item.command}>
                        <span className="font-mono text-ink">/{item.command}</span> —{" "}
                        {item.description}
                      </li>
                    ))}
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
                  {code ? "Buat kode baru" : `Hubungkan ${meta.label}`}
                </button>
              </>
            )}
          </>
        ) : null}
      </div>
    </Card>
  );
}
