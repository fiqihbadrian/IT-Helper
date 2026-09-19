"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Pencil, Plus, Power, Trash2, X } from "lucide-react";

import {
  createChannel,
  deleteChannel,
  setChannelActive,
  updateChannel,
} from "@/app/actions/channels";
import { Alert, EmptyState, Field } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Card, CardHeader } from "@/components/ui/Card";
import { PRIORITY_META, TICKET_PRIORITIES } from "@/lib/constants";
import { formatOrigins } from "@/lib/validation";
import { cn } from "@/lib/utils";
import type { ChannelSummary } from "@/services/channels";
import type { Category, Department } from "@/types";

export function ChannelManager({
  channels,
  appUrl,
  categories,
  departments,
}: {
  channels: ChannelSummary[];
  appUrl: string;
  categories: Category[];
  departments: Department[];
}) {
  const [editing, setEditing] = useState<ChannelSummary | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function close() {
    setOpen(false);
    setEditing(null);
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          New channel
        </button>
      </div>

      {open ? (
        <Card className="mb-5">
          <CardHeader
            title={editing ? `Edit ${editing.name}` : "New channel"}
            description="One channel per website that may embed the chat widget."
            action={
              <button type="button" className="btn-ghost p-1.5" onClick={close} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            }
          />
          <div className="px-5 py-4">
            <ChannelForm
              channel={editing}
              categories={categories}
              departments={departments}
              onDone={() => {
                close();
                router.refresh();
              }}
            />
          </div>
        </Card>
      ) : null}

      {channels.length === 0 ? (
        <Card>
          <EmptyState
            title="No channels yet"
            description="Create one to get an embed snippet you can paste into a website."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              appUrl={appUrl}
              onEdit={() => {
                setEditing(channel);
                setOpen(true);
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ChannelCard({
  channel,
  appUrl,
  onEdit,
}: {
  channel: ChannelSummary;
  appUrl: string;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggleState, toggleAction] = useActionState(setChannelActive, null);
  const [deleteState, deleteAction] = useActionState(deleteChannel, null);

  const snippet = `<script src="${appUrl}/widget.js" data-key="${channel.public_key}" async></script>`;

  useEffect(() => {
    if (toggleState?.ok || deleteState?.ok) router.refresh();
  }, [toggleState, deleteState, router]);

  useEffect(() => {
    if (toggleState && !toggleState.ok && toggleState.error) setError(toggleState.error);
  }, [toggleState]);

  useEffect(() => {
    if (deleteState && !deleteState.ok && deleteState.error) setError(deleteState.error);
  }, [deleteState]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy. Select the snippet and copy it manually.");
    }
  }

  const origins = channel.allowed_origins;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {channel.name}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                channel.is_active
                  ? "bg-success-soft text-success-ink"
                  : "bg-surface-muted text-ink-muted",
              )}
            >
              {channel.is_active ? "Active" : "Off"}
            </span>
          </span>
        }
        description={`/${channel.slug} · ${channel.tickets} ticket(s), ${channel.openTickets} still open`}
        action={
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="btn-ghost px-2.5 py-1.5 text-[13px]" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
            <form action={toggleAction}>
              <input type="hidden" name="id" value={channel.id} />
              <input type="hidden" name="isActive" value={String(!channel.is_active)} />
              <SubmitButton className="btn-ghost px-2.5 py-1.5 text-[13px]" pendingLabel="…">
                <Power className="h-3.5 w-3.5" />
                {channel.is_active ? "Switch off" : "Switch on"}
              </SubmitButton>
            </form>
            {channel.tickets === 0 ? (
              <form action={deleteAction}>
                <input type="hidden" name="id" value={channel.id} />
                <SubmitButton className="btn-ghost px-2.5 py-1.5 text-[13px]" pendingLabel="…">
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </SubmitButton>
              </form>
            ) : null}
          </div>
        }
      />

      <div className="space-y-4 px-5 py-4">
        {error ? <Alert>{error}</Alert> : null}

        <div>
          <p className="label">Embed snippet</p>
          <div className="flex flex-wrap items-start gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-surface-border bg-surface-muted px-3 py-2 font-mono text-[12px] text-ink">
              {snippet}
            </code>
            <button type="button" className="btn-secondary" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-subtle">
            Paste this just before <code className="font-mono">&lt;/body&gt;</code> on the site. The
            key is public — it names the channel, it does not grant access to anything.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="label">Allowed origins</p>
            {origins.length === 0 ? (
              <p className="text-[13px] text-danger-ink">
                None — the widget refuses every request until you add one.
              </p>
            ) : (
              <ul className="space-y-0.5 font-mono text-[12px] text-ink-muted">
                {origins.map((origin) => (
                  <li key={origin} className="truncate">
                    {origin === "*" ? "* (any origin)" : origin}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="label">New tickets</p>
            <p className="text-[13px] text-ink-muted">
              {PRIORITY_META[channel.default_priority].label} priority ·{" "}
              {channel.category?.name ?? "no category"} ·{" "}
              {channel.department?.name ?? "no department"}
            </p>
          </div>
          <div>
            <p className="label">Greeting</p>
            <p className="text-[13px] text-ink-muted">{channel.greeting}</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ChannelForm({
  channel,
  categories,
  departments,
  onDone,
}: {
  channel: ChannelSummary | null;
  categories: Category[];
  departments: Department[];
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(channel ? updateChannel : createChannel, null);

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok && state.error ? <Alert>{state.error}</Alert> : null}
      {channel ? <input type="hidden" name="id" value={channel.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="channel-name" required>
          <input
            id="channel-name"
            name="name"
            required
            maxLength={80}
            defaultValue={channel?.name ?? ""}
            placeholder="Company website"
            className="input"
          />
        </Field>

        <Field
          label="Accent colour"
          htmlFor="channel-accent"
          hint="Used for the launcher and the visitor's own messages."
        >
          <input
            id="channel-accent"
            name="accentColor"
            required
            type="color"
            defaultValue={channel?.accent_color ?? "#4f46e5"}
            className="input h-10 p-1"
          />
        </Field>
      </div>

      <Field
        label="Allowed origins"
        htmlFor="channel-origins"
        hint="One per line. Use * to allow any site — only for a channel you do not care about."
      >
        <textarea
          id="channel-origins"
          name="origins"
          rows={3}
          defaultValue={formatOrigins(channel?.allowed_origins)}
          placeholder={"https://example.com\nhttps://www.example.com"}
          className="input font-mono text-[12px]"
        />
      </Field>

      <Field label="Greeting" htmlFor="channel-greeting" required>
        <input
          id="channel-greeting"
          name="greeting"
          required
          maxLength={400}
          defaultValue={channel?.greeting ?? "Hi! Tell us what is wrong and the IT team will pick it up."}
          className="input"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Default priority" htmlFor="channel-priority">
          <select
            id="channel-priority"
            name="defaultPriority"
            defaultValue={channel?.default_priority ?? "MEDIUM"}
            className="input"
          >
            {TICKET_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_META[priority].label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Default category" htmlFor="channel-category">
          <select
            id="channel-category"
            name="defaultCategoryId"
            defaultValue={channel?.default_category_id ?? ""}
            className="input"
          >
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Department" htmlFor="channel-department">
          <select
            id="channel-department"
            name="departmentId"
            defaultValue={channel?.department_id ?? ""}
            className="input"
          >
            <option value="">No department</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">
          {channel ? "Save channel" : "Create channel"}
        </SubmitButton>
      </div>
    </form>
  );
}
