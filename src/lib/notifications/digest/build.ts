import type { Priority, RoleName } from "@/generated/prisma/client";
import { DIGEST_SECTIONS, KINDS, isNotificationKind, type DigestSection } from "../kinds";

/**
 * One person's digest, as a model the renderer draws and the tests inspect.
 * Pure: rows in, sections of subject groups out. Nothing here knows about
 * Prisma or mail.
 *
 * Rules, in order (plan §I): dedupe the same event on the same subject,
 * let a completion supersede the assignment that led to it, collapse an
 * engine batch into one line, put each row in its section, group by the job
 * / case / lead it is about, cap what a section and a subject may show, and
 * count what was hidden so the ledger can say so.
 */

export type DigestSubject = {
  /** `job:<id>` · `case:<id>` · `lead:<id>` · `none`. */
  key: string;
  label: string;
  code: string | null;
  href: string | null;
};

export type DigestRowInput = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string;
  priority: Priority;
  actionRequired: boolean;
  recipientReason: string;
  subjectType: string;
  subjectId: string | null;
  taskId: string | null;
  batchKey: string | null;
  occurrences: number;
  lastOccurredAt: Date;
  subject: DigestSubject;
};

export type DigestItem = {
  /** The rows this line stands for (one, or a whole batch). */
  rowIds: string[];
  kind: string;
  title: string;
  body: string | null;
  href: string;
  priority: Priority;
  occurrences: number;
  actionRequired: boolean;
  /** Set when several rows collapsed into this line. */
  collapsed: { count: number; titles: string[] } | null;
};

export type DigestGroup = DigestSubject & { items: DigestItem[]; hidden: number };

export type DigestSectionModel = { section: DigestSection; groups: DigestGroup[]; hiddenGroups: number; itemCount: number };

export type DigestModel = {
  sections: DigestSectionModel[];
  /** Lines shown, batches counted once. */
  itemCount: number;
  /** Rows folded into batch lines. */
  collapsedCount: number;
  /** Rows behind a "+N more". They still count as delivered. */
  hiddenCount: number;
  actionCount: number;
  /** Every row the model covers, shown or hidden. */
  rowIds: string[];
  sectionCounts: Partial<Record<DigestSection, number>>;
};

export type BuildOptions = {
  role: RoleName;
  maxPerSection: number;
  maxPerSubject: number;
  batchCollapseThreshold: number;
};

const PRIORITY_RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** A completion beats the assignment that led to it; a reassignment beats the assignment. */
const SUPERSEDES: Record<string, string[]> = {
  "task.completed": ["task.assigned", "task.reassigned", "task.ready", "task.blocked"],
  "task.reassigned": ["task.assigned", "task.ready"],
};

const OWNER_LIKE = new Set(["assignee", "mentioned", "manager", "owner"]);

/** Sections a crew lead's compact digest leaves out: office chatter, not their work. */
const CREW_LEAD_DROPS = new Set<DigestSection>(["JOB_UPDATES", "COMPLETED"]);

function sectionOf(row: DigestRowInput): DigestSection {
  if (row.actionRequired && OWNER_LIKE.has(row.recipientReason)) return "ACTION_REQUIRED";
  return isNotificationKind(row.kind) ? KINDS[row.kind].section : "OTHER";
}

function collapsible(kind: string): boolean {
  return isNotificationKind(kind) ? KINDS[kind].collapsible : false;
}

function newer(a: DigestRowInput, b: DigestRowInput): DigestRowInput {
  return a.lastOccurredAt >= b.lastOccurredAt ? a : b;
}

/** Same event on the same subject twice → one row, occurrences summed. */
export function dedupeRows(rows: DigestRowInput[]): DigestRowInput[] {
  const byKey = new Map<string, DigestRowInput>();
  for (const r of rows) {
    const key = `${r.kind}:${r.subjectType}:${r.subjectId ?? "-"}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, r);
    else byKey.set(key, { ...newer(prev, r), occurrences: prev.occurrences + r.occurrences });
  }
  return Array.from(byKey.values());
}

/** On one task, a completion hides the assignment that led to it. Never across subjects. */
export function supersedeRows(rows: DigestRowInput[]): DigestRowInput[] {
  const byTask = new Map<string, DigestRowInput[]>();
  for (const r of rows) {
    if (!r.taskId) continue;
    if (!byTask.has(r.taskId)) byTask.set(r.taskId, []);
    byTask.get(r.taskId)!.push(r);
  }
  const drop = new Set<string>();
  for (const list of byTask.values()) {
    for (const winner of list) {
      const losers = SUPERSEDES[winner.kind];
      if (!losers) continue;
      for (const other of list) {
        if (other.id !== winner.id && losers.includes(other.kind) && other.lastOccurredAt <= winner.lastOccurredAt) drop.add(other.id);
      }
    }
  }
  return rows.filter((r) => !drop.has(r.id));
}

/** Rows from one engine run, of a collapsible kind, in the same section and subject → one line. */
function collapseBatches(rows: DigestRowInput[], threshold: number): { items: (DigestItem & { section: DigestSection; subject: DigestSubject })[]; collapsedCount: number } {
  const single = (r: DigestRowInput) => ({
    rowIds: [r.id],
    kind: r.kind,
    title: r.title,
    body: r.body,
    href: r.href,
    priority: r.priority,
    occurrences: r.occurrences,
    actionRequired: r.actionRequired,
    collapsed: null,
    section: sectionOf(r),
    subject: r.subject,
  });
  const batches = new Map<string, DigestRowInput[]>();
  const loose: DigestRowInput[] = [];
  for (const r of rows) {
    if (r.batchKey && collapsible(r.kind)) {
      const key = `${r.batchKey}|${sectionOf(r)}|${r.subject.key}`;
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key)!.push(r);
    } else loose.push(r);
  }
  const items: (DigestItem & { section: DigestSection; subject: DigestSubject })[] = loose.map(single);
  let collapsedCount = 0;
  for (const list of batches.values()) {
    if (list.length < threshold) {
      items.push(...list.map(single));
      continue;
    }
    list.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.lastOccurredAt.getTime() - a.lastOccurredAt.getTime());
    const first = list[0]!;
    const label = isNotificationKind(first.kind) ? KINDS[first.kind].label : "Updates";
    const noun = first.kind === "task.ready" ? "workflow steps became ready" : first.kind === "task.completed" ? "steps completed" : first.kind.startsWith("task.") ? "tasks assigned to you" : `${label.toLowerCase()} ×${list.length}`;
    collapsedCount += list.length;
    items.push({
      rowIds: list.map((r) => r.id),
      kind: first.kind,
      title: `${list.length} ${noun}`,
      body: null,
      href: first.subject.href ?? first.href,
      priority: first.priority,
      occurrences: list.reduce((n, r) => n + r.occurrences, 0),
      actionRequired: list.some((r) => r.actionRequired),
      collapsed: { count: list.length, titles: list.slice(0, 3).map((r) => r.title) },
      section: sectionOf(first),
      subject: first.subject,
    });
  }
  return { items, collapsedCount };
}

function groupRank(g: DigestGroup): [number, number] {
  const best = Math.min(...g.items.map((i) => PRIORITY_RANK[i.priority]));
  return [best, -g.items.length];
}

export function buildDigest(rows: DigestRowInput[], opts: BuildOptions): DigestModel {
  const deduped = supersedeRows(dedupeRows(rows));
  const { items, collapsedCount } = collapseBatches(deduped, opts.batchCollapseThreshold);

  const bySection = new Map<DigestSection, Map<string, DigestGroup>>();
  for (const it of items) {
    if (opts.role === "CREW_LEAD" && CREW_LEAD_DROPS.has(it.section)) continue;
    if (!bySection.has(it.section)) bySection.set(it.section, new Map());
    const groups = bySection.get(it.section)!;
    if (!groups.has(it.subject.key)) groups.set(it.subject.key, { ...it.subject, items: [], hidden: 0 });
    const { section: _s, subject: _j, ...item } = it;
    void _s;
    void _j;
    groups.get(it.subject.key)!.items.push(item);
  }

  const sections: DigestSectionModel[] = [];
  let itemCount = 0;
  let hiddenCount = 0;
  let actionCount = 0;
  const rowIds = new Set<string>();
  const sectionCounts: Partial<Record<DigestSection, number>> = {};
  for (const section of DIGEST_SECTIONS) {
    const groups = bySection.get(section);
    if (!groups || groups.size === 0) continue;
    const ordered = Array.from(groups.values()).sort((a, b) => {
      const [pa, na] = groupRank(a);
      const [pb, nb] = groupRank(b);
      return pa - pb || na - nb || a.label.localeCompare(b.label);
    });
    let sectionItems = 0;
    for (const g of ordered) {
      g.items.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title));
      for (const i of g.items) for (const id of i.rowIds) rowIds.add(id);
      if (g.items.length > opts.maxPerSubject) {
        const extra = g.items.splice(opts.maxPerSubject);
        g.hidden = extra.reduce((n, i) => n + i.rowIds.length, 0);
        hiddenCount += g.hidden;
      }
      sectionItems += g.items.length;
    }
    const shown = ordered.slice(0, opts.maxPerSection);
    const hiddenGroups = ordered.length - shown.length;
    for (const g of ordered.slice(opts.maxPerSection)) {
      hiddenCount += g.items.reduce((n, i) => n + i.rowIds.length, 0) + g.hidden;
      sectionItems -= g.items.length;
    }
    itemCount += sectionItems;
    if (section === "ACTION_REQUIRED") actionCount += sectionItems;
    sectionCounts[section] = sectionItems;
    sections.push({ section, groups: shown, hiddenGroups, itemCount: sectionItems });
  }

  return { sections, itemCount, collapsedCount, hiddenCount, actionCount, rowIds: Array.from(rowIds), sectionCounts };
}
