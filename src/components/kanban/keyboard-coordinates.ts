import { KeyboardCode, type KeyboardCoordinateGetter } from "@dnd-kit/core";

/**
 * Keyboard drags jump between columns, not pixels. Left/Right pick the
 * neighbouring droppable in board order and land inside it; Up/Down are
 * ignored because columns are not sortable. The neighbour is scrolled into
 * view so a 15-column board stays usable without a mouse.
 */
export const columnKeyboardCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
  const { droppableRects, droppableContainers } = context;
  const containers = droppableContainers.getEnabled();
  if (containers.length === 0) return undefined;

  // Which column are we over now?
  let currentIndex = containers.findIndex((c) => {
    const r = droppableRects.get(c.id);
    return r && currentCoordinates.x >= r.left && currentCoordinates.x <= r.right;
  });
  if (currentIndex < 0) currentIndex = 0;

  let target = currentIndex;
  if (event.code === KeyboardCode.Right) target = Math.min(containers.length - 1, currentIndex + 1);
  else if (event.code === KeyboardCode.Left) target = Math.max(0, currentIndex - 1);
  else return undefined;

  const container = containers[target];
  const rect = droppableRects.get(container.id);
  if (!rect) return undefined;
  container.node.current?.scrollIntoView?.({ inline: "nearest", block: "nearest", behavior: "smooth" });
  return { x: rect.left + 16, y: rect.top + 56 };
};
