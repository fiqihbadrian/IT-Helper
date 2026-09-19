import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { TelegramLogin } from "@/components/auth/TelegramLogin";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { getCurrentProfile } from "@/lib/auth";
import { safeNextPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Sign in with Telegram · IT Helpdesk" };

export default async function TelegramLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (profile) redirect("/dashboard");

  const { next } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink text-xs font-bold text-surface">
            IT
          </span>
          <div>
            <p className="text-sm font-semibold leading-tight">IT Helpdesk</p>
            <p className="text-xs text-ink-muted">Internal support system</p>
          </div>
          <ThemeToggle className="ml-auto" />
        </div>

        <div className="card px-5 py-6">
          <h1 className="text-base font-semibold">Sign in with Telegram</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            Only works if you have already linked your Telegram account. No password needed.
          </p>
          <div className="mt-5">
            <TelegramLogin next={safeNextPath(next)} />
          </div>
        </div>

        <Link
          href="/login"
          className="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-subtle hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Use email and password instead
        </Link>
      </div>
    </div>
  );
}
