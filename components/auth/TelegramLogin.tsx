"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, RotateCw } from "lucide-react";

import { Alert } from "@/components/ui/Field";

interface BotLink {
  bot: "employee" | "staff";
  username: string;
  url: string;
}

interface Handshake {
  code: string;
  expiresAt: string;
  link: BotLink | null;
}

const POLL_MS = 2000;

/**
 * The browser end of "sign in with Telegram".
 *
 * Ask for a code, show it, then poll until the code comes back with a profile
 * attached. The session cookie is set by the poll response, so the only thing
 * left to do when that happens is a full navigation — a client-side route change
 * would not carry the new cookie into the next request.
 */
export function TelegramLogin({ next }: { next: string }) {
  const [handshake, setHandshake] = useState<Handshake | null>(null);
  const [status, setStatus] = useState<"starting" | "waiting" | "expired" | "ready" | "error">(
    "starting",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const stopped = useRef(false);

  const start = useCallback(async () => {
    stopped.current = false;
    setStatus("starting");
    setMessage(null);

    try {
      const response = await fetch("/api/auth/telegram", { method: "POST" });
      const body = await response.json();

      if (!response.ok || !body.ok) {
        setStatus("error");
        setMessage(body?.error?.message ?? "Could not reach the server.");
        return;
      }

      setHandshake(body.data);
      setStatus("waiting");
    } catch {
      setStatus("error");
      setMessage("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if (status !== "waiting" || !handshake) return;

    const timer = setInterval(async () => {
      if (stopped.current) return;

      try {
        const response = await fetch(
          `/api/auth/telegram?code=${encodeURIComponent(handshake.code)}&next=${encodeURIComponent(next)}`,
        );
        const body = await response.json();

        if (!response.ok || !body.ok) {
          stopped.current = true;
          setStatus("error");
          setMessage(body?.error?.message ?? "Could not reach the server.");
          return;
        }

        if (body.data.status === "expired") {
          stopped.current = true;
          setStatus("expired");
          return;
        }

        if (body.data.status === "ready") {
          stopped.current = true;
          setStatus("ready");
          setSignedInAs(body.data.profile?.name ?? null);
          // Long enough to read who just signed in — a code that was claimed by
          // the wrong chat is otherwise invisible.
          setTimeout(() => window.location.assign(body.data.redirect ?? next), 900);
        }
      } catch {
        // A dropped poll is not fatal; the next tick tries again.
      }
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [status, handshake, next]);

  const copy = async () => {
    if (!handshake) return;
    try {
      await navigator.clipboard.writeText(handshake.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  if (status === "ready") {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-surface-muted px-4 py-5">
        <Check className="h-5 w-5 shrink-0 text-success-ink" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Signed in{signedInAs ? ` as ${signedInAs}` : ""}</p>
          <p className="mt-0.5 text-[13px] text-ink-muted">Taking you to your dashboard…</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="space-y-4">
        <Alert tone="error">{message ?? "Something went wrong."}</Alert>
        <button type="button" onClick={() => void start()} className="btn-ghost w-full">
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }

  if (status === "starting" || !handshake) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Preparing a code…
      </div>
    );
  }

  const expired = status === "expired";

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[13px] text-ink-muted">
          1. Open Telegram and send this code to the bot.
        </p>
        <div className="mt-2 flex items-stretch gap-2">
          <code
            className={`flex-1 select-all rounded-lg border border-surface-border bg-surface-muted px-4 py-3 text-center font-mono text-xl font-semibold tracking-[0.2em] ${
              expired ? "text-ink-subtle line-through" : ""
            }`}
          >
            {handshake.code}
          </code>
          <button
            type="button"
            onClick={() => void copy()}
            className="btn-ghost shrink-0 px-3"
            aria-label="Copy code"
          >
            {copied ? (
              <Check className="h-4 w-4 text-success-ink" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <div>
        <p className="text-[13px] text-ink-muted">
          2. The button opens Telegram with the code already filled in. Send it.
        </p>
        <div className="mt-2">
          {handshake.link ? (
            <a
              href={handshake.link.url}
              target="_blank"
              rel="noreferrer"
              className="btn-primary w-full justify-center"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Open @{handshake.link.username}
            </a>
          ) : (
            <Alert tone="warning">
              No Telegram bot is configured on this deployment. Send the code with{" "}
              <code>/login CODE</code> instead, or ask an admin to set the bot username.
            </Alert>
          )}
        </div>
      </div>

      <p className="text-xs text-ink-subtle">
        Only works if your Telegram is already linked to a helpdesk account — link it once under{
        " "}
        <span className="font-medium">Profile → Telegram</span> while signed in. The code is not tied
        to a bot, so either bot can claim it.
      </p>

      <div>
        {expired ? (
          <div className="space-y-3">
            <Alert tone="warning">That code has expired. Nothing was signed in.</Alert>
            <button type="button" onClick={() => void start()} className="btn-ghost w-full">
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Get a new code
            </button>
          </div>
        ) : (
          <p className="flex items-center justify-center gap-2 text-[13px] text-ink-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Waiting for Telegram… this page signs itself in.
          </p>
        )}
      </div>
    </div>
  );
}
