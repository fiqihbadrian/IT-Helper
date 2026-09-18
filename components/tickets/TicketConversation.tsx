import { Avatar } from "@/components/ui/Avatar";
import { AttachmentList } from "@/components/tickets/AttachmentList";
import { formatDateTime } from "@/lib/utils";
import type { CommentWithRelations, TicketAttachment, TicketWithRelations } from "@/types";

function Post({
  authorName,
  authorRole,
  createdAt,
  body,
  attachments,
  isRequester,
}: {
  authorName: string;
  authorRole?: string;
  createdAt: string;
  body: React.ReactNode;
  attachments?: TicketAttachment[];
  isRequester?: boolean;
}) {
  return (
    <li className="px-4 py-5 lg:px-6">
      <div className="flex items-start gap-3">
        <Avatar name={authorName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13px] font-semibold text-ink">{authorName}</span>
            {authorRole ? (
              <span className="text-xs text-ink-muted">{authorRole}</span>
            ) : null}
            {isRequester ? (
              <span className="text-xs text-ink-subtle">· requester</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-ink-subtle">{formatDateTime(createdAt)}</p>
          <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{body}</div>
          {attachments?.length ? (
            <AttachmentList attachments={attachments} className="mt-3" />
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function TicketConversation({
  ticket,
  comments,
  attachments,
}: {
  ticket: TicketWithRelations;
  comments: CommentWithRelations[];
  attachments: TicketAttachment[];
}) {
  return (
    <ol className="divide-y divide-surface-border">
      <Post
        authorName={ticket.requester?.full_name ?? "Requester"}
        createdAt={ticket.created_at}
        body={ticket.description}
        attachments={attachments}
        isRequester
      />

      {comments.map((comment) => (
        <Post
          key={comment.id}
          authorName={comment.author?.full_name ?? "Unknown"}
          authorRole={
            comment.author?.role && comment.author.role !== "employee"
              ? `IT Support${comment.author.role === "admin" ? " · Admin" : ""}`
              : undefined
          }
          createdAt={comment.created_at}
          body={comment.message}
          attachments={comment.attachments}
          isRequester={comment.user_id === ticket.created_by}
        />
      ))}
    </ol>
  );
}
