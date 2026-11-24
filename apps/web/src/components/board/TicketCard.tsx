import { useDraggable } from "@dnd-kit/core";
import { memo } from "react";
import { Link } from "react-router";
import { type Ticket, typeLabel } from "../../api/tickets.ts";
import { formatDateTime, formatModified } from "../../lib/format.ts";

/** Card content, shared by the board card and the drag overlay. */
export function TicketCardContent({ ticket, linked = true }: { ticket: Ticket; linked?: boolean }) {
  return (
    <>
      <div className="card-title">
        {linked ? (
          // draggable={false}: a native link drag would cancel the pointer-based drag.
          <Link to={`/tickets/${ticket.id}`} draggable={false}>
            {ticket.title}
          </Link>
        ) : (
          ticket.title
        )}
      </div>
      <div className="card-meta">
        <span className={`badge badge-${ticket.type}`}>{typeLabel(ticket.type)}</span>
        <span className={ticket.epic ? "card-epic" : "card-epic muted"}>{ticket.epic?.title ?? "No epic"}</span>
      </div>
      <div className="card-footer">
        <time className="card-modified muted" dateTime={ticket.modifiedAt} title={formatDateTime(ticket.modifiedAt)}>
          {formatModified(ticket.modifiedAt)}
        </time>
        {/* Reserved space for a future comment indicator; intentionally empty (no comment count is shown). */}
        <span className="card-slot" aria-hidden="true" />
      </div>
    </>
  );
}

interface TicketCardProps {
  ticket: Ticket;
  /** True while this ticket's move is being saved; the card cannot be dragged again until then. */
  saving: boolean;
}

/**
 * A draggable board card. The whole card is the drag handle: drag with the mouse (after 5 px of movement, so a
 * click on the title still opens the ticket), press and hold for 200 ms on a touch screen, or focus it and use
 * Space / arrow keys / Space.
 */
export const TicketCard = memo(function TicketCard({ ticket, saving }: TicketCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: ticket.id,
    data: { state: ticket.state },
    disabled: saving,
    attributes: { roleDescription: "draggable ticket" },
  });

  const className = ["card", isDragging ? "card-dragging" : "", saving ? "card-saving" : ""].filter(Boolean).join(" ");
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        // Keyboard drags start only on the card itself, so Enter on the title link still opens the ticket.
        setActivatorNodeRef(node);
      }}
      className={className}
      data-testid="ticket-card"
      data-ticket-id={ticket.id}
      aria-label={ticket.title}
      aria-busy={saving || undefined}
      {...attributes}
      {...listeners}
    >
      <TicketCardContent ticket={ticket} />
      {saving && <span className="visually-hidden">Saving…</span>}
    </div>
  );
});
