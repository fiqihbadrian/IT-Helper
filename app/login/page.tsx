import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/LoginForm";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { getCurrentProfile } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in · IT Helpdesk" };

export default async function LoginPage() {
  const profile = await getCurrentProfile();
  if (profile) redirect("/dashboard");

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
          <h1 className="text-base font-semibold">Sign in</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            Use your company email address.
          </p>
          <div className="mt-5">
            <LoginForm />
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-ink-subtle">
          Trouble signing in? Contact the IT Support team.
        </p>
      </div>
    </div>
  );
}
