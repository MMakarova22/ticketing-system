import {
  type Announcements,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useCallback, useMemo, useRef, useState } from "react";
import { stateLabel, TICKET_STATES, type Ticket, type TicketState } from "../../api/tickets.ts";
import type { BoardColumns } from "../../lib/board.ts";
import { BoardColumn } from "./BoardColumn.tsx";
import { TicketCardContent } from "./TicketCard.tsx";

/**
 * The mouse/pen sensor: dnd-kit's PointerSensor (5 px activation distance) restricted to non-touch pointers. Touch
 * input is left to the TouchSensor below, so a finger on a card can still scroll the board and columns.
 */
const [pointerActivator] = PointerSensor.activators;
class NonTouchPointerSensor extends PointerSensor {
  static override activators: typeof PointerSensor.activators = [
    {
      eventName: "onPointerDown",
      handler: (event, options) =>
        event.nativeEvent.pointerType !== "touch" && pointerActivator!.handler(event, options),
    },
  ];
}

/**
 * Touch: press and hold a card for 200 ms (moving less than 5 px) to pick it up. Moving the finger earlier cancels the
 * pick-up and the browser scrolls natively instead; a quick tap is a normal click (the title link still opens).
 */
const touchOptions = { activationConstraint: { delay: 200, tolerance: 5 } };

const STATE_ORDER: readonly TicketState[] = TICKET_STATES.map((s) => s.value);

function isTicketState(value: UniqueIdentifier | undefined | null): value is TicketState {
  return typeof value === "string" && (STATE_ORDER as readonly string[]).includes(value);
}

/** Mouse: the column under the pointer; otherwise (and for the keyboard) the column the card overlaps most. */
const collisionDetection: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const within = pointerWithin(args);
    if (within.length > 0) {
      return within;
    }
  }
  return rectIntersection(args);
};

/**
 * Keyboard drag: Left/Right arrows jump to the centre of the previous/next column; Up/Down do nothing.
 * The target column is tracked in a ref rather than read from `context.over`, which only updates after a render,
 * so fast repeated key presses still advance one column each.
 */
function columnKeyboardCoordinates(column: { current: TicketState | null }): KeyboardCoordinateGetter {
  return (event, { currentCoordinates, context }) => {
    const step = event.code === "ArrowRight" ? 1 : event.code === "ArrowLeft" ? -1 : 0;
    if (step === 0) {
      return undefined;
    }
    event.preventDefault();
    const from = column.current ?? (context.active?.data.current?.state as TicketState | undefined);
    const target = from ? STATE_ORDER[STATE_ORDER.indexOf(from) + step] : undefined;
    const rect = target ? context.droppableRects.get(target) : undefined;
    if (!target || !rect) {
      return undefined;
    }
    column.current = target;
    const width = context.collisionRect?.width ?? 0;
    return { x: rect.left + (rect.width - width) / 2, y: currentCoordinates.y };
  };
}

const screenReaderInstructions = {
  draggable:
    "To move a ticket to another column, press Space to pick it up, use the Left and Right arrow keys to choose " +
    "a column, then press Space to drop it, or Escape to cancel.",
};

interface BoardProps {
  /** All tickets of the team (unfiltered), used to look up the dragged ticket. */
  tickets: readonly Ticket[];
  board: BoardColumns;
  pendingIds: Set<string>;
  onMove: (ticket: Ticket, to: TicketState) => void;
}

/**
 * The five-column Kanban board (spec §8). Any ticket can be dropped on any other column; dropping on its own
 * column does nothing. Persistence and rollback are handled by `onMove` (see `useMoveTicket`).
 */
export function Board({ tickets, board, pendingIds, onMove }: BoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const keyboardColumn = useRef<TicketState | null>(null);
  const keyboardOptions = useMemo(() => ({ coordinateGetter: columnKeyboardCoordinates(keyboardColumn) }), []);
  const sensors = useSensors(
    useSensor(NonTouchPointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, touchOptions),
    useSensor(KeyboardSensor, keyboardOptions),
  );

  const byId = useMemo(() => new Map(tickets.map((t) => [t.id, t])), [tickets]);
  // Announcements read the latest tickets without re-creating the DnD context.
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  const announcements = useMemo<Announcements>(() => {
    const title = (id: UniqueIdentifier) => `"${byIdRef.current.get(String(id))?.title ?? "ticket"}"`;
    const column = (id: UniqueIdentifier | undefined) => (isTicketState(id) ? stateLabel(id) : "no column");
    return {
      onDragStart: ({ active }) => `Picked up ticket ${title(active.id)}.`,
      onDragOver: ({ active, over }) => `Ticket ${title(active.id)} is over ${column(over?.id)}.`,
      onDragEnd: ({ active, over }) => {
        const from = byIdRef.current.get(String(active.id))?.state;
        if (!over || over.id === from) {
          return `Ticket ${title(active.id)} was dropped in its current column.`;
        }
        return `Ticket ${title(active.id)} was moved to ${column(over.id)}.`;
      },
      onDragCancel: ({ active }) => `Moving ticket ${title(active.id)} was cancelled.`,
    };
  }, []);

  const onDragStart = useCallback((event: DragStartEvent) => {
    keyboardColumn.current = byIdRef.current.get(String(event.active.id))?.state ?? null;
    setActiveId(String(event.active.id));
  }, []);
  const onDragCancel = useCallback(() => setActiveId(null), []);
  const onDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setActiveId(null);
      const ticket = byIdRef.current.get(String(active.id));
      const to = over?.id;
      if (ticket && isTicketState(to) && to !== ticket.state) {
        onMove(ticket, to);
      }
    },
    [onMove],
  );

  const activeTicket = activeId ? byId.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="board" data-testid="board">
        {TICKET_STATES.map((state) => (
          <BoardColumn
            key={state.value}
            state={state.value}
            label={state.label}
            tickets={board.columns[state.value]}
            total={board.totals[state.value]}
            pendingIds={pendingIds}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTicket ? (
          <div className="card card-overlay">
            <TicketCardContent ticket={activeTicket} linked={false} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
