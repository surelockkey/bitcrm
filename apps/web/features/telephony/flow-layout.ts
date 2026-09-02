import { branchKeysOf, isBranching, type FlowStep } from "./flow-tree";

/**
 * Where every card and every line goes on the builder canvas.
 *
 * Kept out of the component on purpose: the tidy-tree arithmetic — how wide a
 * subtree is, which column a branch lands in, where a connector turns — is the
 * part that actually breaks, and it breaks silently. Here it can be read and
 * tested without a DOM.
 *
 * Positions are absolute pixels in canvas space. The component pans and zooms
 * by transforming the whole plane, so nothing here knows about the viewport.
 */

/** Card geometry. `x` is a card's CENTRE, `y` is its TOP. */
export const CARD_W = 232;
export const CARD_H = 76;
/** One column per leaf of the tree, wide enough for a card plus a gutter. */
export const COL_W = 288;
/** One row per step: the card, then the connector under it. */
export const ROW_H = 172;
const PAD_X = 56;
const PAD_Y = 40;

/** The call arriving. Not a stored node — the flow's numbers, drawn as a step. */
export const ENTRY_ID = "__entry__";

export interface LayoutNode {
  id: string;
  kind: "entry" | "step";
  /** Absent on the entry card, which stands for the numbers, not a step. */
  step?: FlowStep;
  /** Which sequence this step lives in, and where — what editing needs. */
  path: string[];
  index: number;
  /** How many steps share this sequence, so "move down" can stop at the end. */
  siblings: number;
  /**
   * Whether reordering is offered here. A branching step has to stay last in
   * its sequence — `toGraph` gives it no main line, so anything below it would
   * simply stop happening — which rules out moving it, and rules out moving
   * its neighbour past it.
   */
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  x: number;
  y: number;
}

export interface LayoutLink {
  id: string;
  /** Corner points of the line, in order. Two for a drop, four for a split. */
  points: { x: number; y: number }[];
  /** Named only when the line is an exit from a branching step. */
  label?: string;
  /** The `+` that adds a step here, and where the step would land. */
  plus?: { x: number; y: number; path: string[]; index: number };
}

export interface FlowLayout {
  nodes: LayoutNode[];
  links: LayoutLink[];
  width: number;
  height: number;
}

/**
 * How many columns a sequence needs.
 *
 * Only the last step of a sequence can branch — `toTree` ends a sequence at
 * one and the canvas refuses to add after one — so the width of a sequence is
 * the width of its branches, or a single column when it doesn't branch.
 */
function measure(sequence: FlowStep[]): number {
  const last = sequence[sequence.length - 1];
  if (!last?.branches) return 1;
  const keys = branchKeysOf(last.node);
  if (keys.length === 0) return 1;
  const total = keys.reduce(
    (sum, { key }) => sum + measure(last.branches?.[key] ?? []),
    0,
  );
  return Math.max(1, total);
}

export function layoutFlow(steps: FlowStep[]): FlowLayout {
  const nodes: LayoutNode[] = [];
  const links: LayoutLink[] = [];

  const columns = measure(steps);
  const centreOf = (colStart: number, span: number) =>
    PAD_X + (colStart + span / 2) * COL_W;
  const topOf = (row: number) => PAD_Y + row * ROW_H;

  const rootX = centreOf(0, columns);
  nodes.push({
    id: ENTRY_ID,
    kind: "entry",
    path: [],
    index: -1,
    siblings: 0,
    canMoveEarlier: false,
    canMoveLater: false,
    x: rootX,
    y: topOf(0),
  });

  let deepestRow = 0;

  /**
   * Draw one sequence down its own column, then recurse into whatever the
   * last step branches into. `from` is the point the incoming line starts at.
   */
  const place = (
    sequence: FlowStep[],
    path: string[],
    colStart: number,
    span: number,
    row: number,
    from: { x: number; y: number },
    label?: string,
  ) => {
    const x = centreOf(colStart, span);
    const key = path.join("/") || "root";

    // The line into this sequence. With nothing here yet it still has to end
    // in a `+`, or a branch could never be filled in.
    const head = { x, y: sequence.length ? topOf(row) : topOf(row) + CARD_H / 2 };
    links.push({
      id: `link-${key}-in`,
      points: elbow(from, head),
      label,
      // On a line that reaches a step, the `+` rides the descent halfway down.
      // On one that reaches nothing, it sits where the missing card would be —
      // it IS the branch until somebody fills it in.
      plus: sequence.length
        ? { x: head.x, y: (from.y + head.y) / 2, path, index: 0 }
        : { x: head.x, y: head.y, path, index: 0 },
    });
    if (!sequence.length) {
      deepestRow = Math.max(deepestRow, row);
      return;
    }

    sequence.forEach((step, index) => {
      const y = topOf(row + index);
      deepestRow = Math.max(deepestRow, row + index);
      const fixed = isBranching(step.node.type);
      nodes.push({
        id: step.node.id,
        kind: "step",
        step,
        path,
        index,
        siblings: sequence.length,
        canMoveEarlier: !fixed && index > 0,
        canMoveLater:
          !fixed &&
          index < sequence.length - 1 &&
          !isBranching(sequence[index + 1].node.type),
        x,
        y,
      });

      // The connector down to the step drawn under this one.
      if (index < sequence.length - 1) {
        const a = { x, y: y + CARD_H };
        const b = { x, y: topOf(row + index + 1) };
        links.push({
          id: `link-${key}-${index}`,
          points: [a, b],
          plus: { x, y: (a.y + b.y) / 2, path, index: index + 1 },
        });
      }
    });

    const last = sequence[sequence.length - 1];
    const lastRow = row + sequence.length - 1;
    const lastY = topOf(lastRow);

    if (!last.branches) {
      // A tail stub, so the end of a flow is still somewhere you can add to.
      const a = { x, y: lastY + CARD_H };
      const b = { x, y: lastY + CARD_H + ROW_H - CARD_H };
      links.push({
        id: `link-${key}-tail`,
        points: [a, b],
        plus: { x, y: (a.y + b.y) / 2, path, index: sequence.length },
      });
      return;
    }

    // A split leaves from the card's waist, so the two arms read as one line
    // passing through it rather than two lines leaving the bottom.
    const port = { x, y: lastY + CARD_H / 2 };
    let column = colStart;
    for (const { key: branchKey, label: branchLabel } of branchKeysOf(last.node)) {
      const branch = last.branches[branchKey] ?? [];
      const branchSpan = measure(branch);
      place(
        branch,
        [...path, last.node.id, branchKey],
        column,
        branchSpan,
        lastRow + 1,
        port,
        branchLabel,
      );
      column += branchSpan;
    }
  };

  place(steps, [], 0, columns, 1, { x: rootX, y: topOf(0) + CARD_H });

  return {
    nodes,
    links,
    width: PAD_X * 2 + columns * COL_W,
    height: PAD_Y * 2 + (deepestRow + 1) * ROW_H,
  };
}

/**
 * The corner points between two ports. Straight down when they share a column;
 * out, along and down when they don't — the shape a split makes.
 */
function elbow(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] {
  if (from.x === to.x) return [from, to];
  return [from, { x: to.x, y: from.y }, to];
}
