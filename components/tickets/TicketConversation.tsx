import { Avatar } from "@/components/ui/Avatar";
import { SourceBadge } from "@/components/ui/Badge";
import { AttachmentList } from "@/components/tickets/AttachmentList";
import { formatDateTime, isExternalTicket, requesterName } from "@/lib/utils";
import type {
  CommentWithRelations,
  TicketAttachment,
  TicketSource,
  TicketWithRelations,
} from "@/types";

function Post({
  authorName,
  authorRole,
  createdAt,
  body,
  attachments,
  isRequester,
  source,
}: {
  authorName: string;
  authorRole?: string;
  createdAt: string;
  body: React.ReactNode;
  attachments?: TicketAttachment[];
  isRequester?: boolean;
  source?: TicketSource;
}) {
  return (
    <li className="px-4 py-5 lg:px-6">
      <div className="flex items-start gap-3">
        <Avatar name={authorName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[13px] font-semibold text-ink">{authorName}</span>
            {authorRole ? (
              <span className="text-xs text-ink-muted">{authorRole}</span>
            ) : null}
            {isRequester ? (
              <span className="text-xs text-ink-subtle">· requester</span>
            ) : null}
            {source ? <SourceBadge source={source} /> : null}
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
  const external = isExternalTicket(ticket);

  return (
    <ol className="divide-y divide-surface-border">
      <Post
        authorName={requesterName(ticket)}
        authorRole={external ? "Website visitor" : undefined}
        createdAt={ticket.created_at}
        body={ticket.description}
        attachments={attachments}
        isRequester
        source={ticket.source}
      />

      {comments.map((comment) => {
        const fromRequester = comment.user_id === ticket.created_by;
        // A visitor's words are stored under the channel's machine profile, so
        // the contact row is what actually names them.
        const authorName =
          fromRequester && external
            ? ticket.contact!.name
            : (comment.author?.full_name ?? "Unknown");

        return (
          <Post
            key={comment.id}
            authorName={authorName}
            authorRole={
              fromRequester && external
                ? "Website visitor"
                : comment.author?.role && comment.author.role !== "employee"
                  ? `IT Support${comment.author.role === "admin" ? " · Admin" : ""}`
                  : undefined
            }
            createdAt={comment.created_at}
            body={comment.message}
            attachments={comment.attachments}
            isRequester={fromRequester}
          />
        );
      })}
    </ol>
  );
}
