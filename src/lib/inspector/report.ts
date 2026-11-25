import type { Box } from "./boxes";
import { SEVERITY_LABEL, SEVERITY_ORDER, type Severity } from "./state";

/**
 * The inspection report (Phase 1b). Pure: from the inspection as read to
 * what the PDF prints.
 *
 * - Only CONFIRMED findings are printed, whoever asks: the report is the
 *   document that may go to an owner or a contractor, and nothing reaches
 *   them unconfirmed. No AI confidence, no area verdicts, no AI cost.
 * - Each photo with findings is printed once, its findings numbered on it
 *   in the same order as the list under it.
 * - An inspection that is still open is marked as a draft.
 * - Every report carries `DISCLAIMER`.
 */
export const DISCLAIMER =
  "This is a visual review of workmanship from photographs, prepared with AI assistance and confirmed by a person. It is not a building-code inspection, a permit inspection, an engineering opinion or a warranty. Concealed work and anything the photographs do not show were not reviewed.";

export type ReportFindingIn = {
  id: string;
  areaId: string | null;
  photoId: string | null;
  title: string;
  evidence: string;
  action: string | null;
  physicalCheck: string | null;
  severity: string;
  tradeLabel: string;
  boxes: readonly Box[];
  review: string;
  resolved: boolean;
  punch: { status: string } | null;
  source: string;
};

export type ReportInput = {
  number: string;
  kindLabel: string;
  status: "OPEN" | "ACCEPTED" | "CLOSED";
  title: string | null;
  place: string;
  jobCode: string | null;
  contractor: string | null;
  qualityLabel: string;
  startedBy: string | null;
  createdAt: Date;
  acceptedAt: Date | null;
  acceptedBy: string | null;
  acceptOverride: string | null;
  areas: { id: string; name: string; tradeLabel: string | null; photoCount: number }[];
  photos: { id: string; areaId: string | null; width: number; height: number }[];
  findings: readonly ReportFindingIn[];
  /** Proposed findings still waiting for a person (0 when the viewer cannot see them). */
  toReview: number;
};

export type ReportStatus = "Open" | "Punch item open" | "Fixed";

export type ReportFinding = {
  n: number;
  title: string;
  severity: Severity;
  severityLabel: string;
  trade: string;
  evidence: string;
  action: string | null;
  physicalCheck: string | null;
  status: ReportStatus;
  addedByPerson: boolean;
  boxes: readonly Box[];
};

export type ReportPhoto = { photoId: string; width: number; height: number; findings: ReportFinding[] };

export type ReportArea = {
  name: string;
  trade: string | null;
  photoCount: number;
  photos: ReportPhoto[];
  /** Confirmed findings with no photo. */
  unplaced: ReportFinding[];
};

export type ReportModel = {
  title: string;
  number: string;
  kindLabel: string;
  place: string;
  jobCode: string | null;
  contractor: string | null;
  qualityLabel: string;
  startedBy: string | null;
  createdAt: Date;
  draft: boolean;
  statusLine: string;
  acceptOverride: string | null;
  toReview: number;
  totals: { findings: number; open: number; fixed: number; bySeverity: { severity: Severity; label: string; count: number }[]; photos: number };
  areas: ReportArea[];
  disclaimer: string;
};

function statusOf(f: ReportFindingIn): ReportStatus {
  if (f.resolved) return "Fixed";
  if (f.punch && f.punch.status !== "CANCELLED") return "Punch item open";
  return "Open";
}

function asSeverity(s: string): Severity {
  return (s in SEVERITY_ORDER ? s : "MINOR") as Severity;
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
}

export function reportStatusLine(i: Pick<ReportInput, "status" | "acceptedAt" | "acceptedBy" | "acceptOverride">): string {
  if (i.status === "ACCEPTED") {
    const by = i.acceptedBy ? ` by ${i.acceptedBy}` : "";
    const on = i.acceptedAt ? ` on ${fmtDay(i.acceptedAt)}` : "";
    return `Work accepted${by}${on}${i.acceptOverride ? " with open items" : ""}`;
  }
  if (i.status === "CLOSED") return "Closed without acceptance";
  return "Draft — the inspection is still open";
}

const order = (a: ReportFindingIn, b: ReportFindingIn) => SEVERITY_ORDER[asSeverity(a.severity)] - SEVERITY_ORDER[asSeverity(b.severity)];

export function buildReport(i: ReportInput): ReportModel {
  const confirmed = i.findings.filter((f) => f.review === "CONFIRMED");
  const photoById = new Map(i.photos.map((p) => [p.id, p]));
  const areaList: { id: string | null; name: string; trade: string | null; photoCount: number }[] = i.areas.map((a) => ({ id: a.id, name: a.name, trade: a.tradeLabel, photoCount: a.photoCount }));
  if (confirmed.some((f) => !f.areaId || !i.areas.some((a) => a.id === f.areaId))) {
    areaList.push({ id: null, name: "General", trade: null, photoCount: i.photos.filter((p) => !p.areaId).length });
  }
  const known = new Set(i.areas.map((a) => a.id));

  let n = 0;
  const toFinding = (f: ReportFindingIn): ReportFinding => {
    const severity = asSeverity(f.severity);
    return {
      n: ++n,
      title: f.title,
      severity,
      severityLabel: SEVERITY_LABEL[severity],
      trade: f.tradeLabel,
      evidence: f.evidence,
      action: f.action,
      physicalCheck: f.physicalCheck,
      status: statusOf(f),
      addedByPerson: f.source === "PERSON",
      boxes: f.boxes,
    };
  };

  const areas: ReportArea[] = [];
  for (const a of areaList) {
    const mine = confirmed.filter((f) => (a.id ? f.areaId === a.id : !f.areaId || !known.has(f.areaId))).sort(order);
    const photos: ReportPhoto[] = [];
    const unplaced: ReportFinding[] = [];
    // photos in the order of their worst finding; findings numbered photo by photo
    const byPhoto = new Map<string, ReportFindingIn[]>();
    const loose: ReportFindingIn[] = [];
    for (const f of mine) {
      const p = f.photoId ? photoById.get(f.photoId) : undefined;
      if (!p) loose.push(f);
      else byPhoto.set(p.id, [...(byPhoto.get(p.id) ?? []), f]);
    }
    for (const [photoId, list] of byPhoto) {
      const p = photoById.get(photoId)!;
      photos.push({ photoId, width: p.width, height: p.height, findings: list.map(toFinding) });
    }
    for (const f of loose) unplaced.push(toFinding(f));
    if (!photos.length && !unplaced.length && a.id === null) continue;
    areas.push({ name: a.name, trade: a.trade, photoCount: a.photoCount, photos, unplaced });
  }

  const all = areas.flatMap((a) => [...a.photos.flatMap((p) => p.findings), ...a.unplaced]);
  const bySeverity = (Object.keys(SEVERITY_ORDER) as Severity[])
    .map((s) => ({ severity: s, label: SEVERITY_LABEL[s], count: all.filter((f) => f.severity === s).length }))
    .filter((s) => s.count > 0);
  const fixed = all.filter((f) => f.status === "Fixed").length;

  return {
    title: i.title?.trim() || `${i.kindLabel} — ${i.place}`,
    number: i.number,
    kindLabel: i.kindLabel,
    place: i.place,
    jobCode: i.jobCode,
    contractor: i.contractor,
    qualityLabel: i.qualityLabel,
    startedBy: i.startedBy,
    createdAt: i.createdAt,
    draft: i.status === "OPEN",
    statusLine: reportStatusLine(i),
    acceptOverride: i.status === "ACCEPTED" ? i.acceptOverride : null,
    toReview: i.status === "OPEN" ? i.toReview : 0,
    totals: { findings: all.length, open: all.length - fixed, fixed, bySeverity, photos: i.photos.length },
    areas,
    disclaimer: DISCLAIMER,
  };
}

/** The photos the PDF needs bytes for. */
export function reportPhotoIds(m: ReportModel): string[] {
  return m.areas.flatMap((a) => a.photos.map((p) => p.photoId));
}

/** The printed size of a photo fitted inside `maxW` × `maxH` points (aspect kept). */
export function printSize(photo: { width: number; height: number }, maxW: number, maxH: number): { width: number; height: number } {
  const s = Math.min(maxW / photo.width, maxH / photo.height);
  return { width: Math.round(photo.width * s * 100) / 100, height: Math.round(photo.height * s * 100) / 100 };
}

/** A box (stored-photo pixels) on the photo as printed `printed` points, clamped to it. */
export function boxOnPrint(b: Box, photo: { width: number; height: number }, printed: { width: number; height: number }): { left: number; top: number; width: number; height: number } {
  const sx = printed.width / photo.width;
  const sy = printed.height / photo.height;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const left = clamp(b.x1 * sx, printed.width);
  const top = clamp(b.y1 * sy, printed.height);
  return { left, top, width: clamp(b.x2 * sx, printed.width) - left, height: clamp(b.y2 * sy, printed.height) - top };
}

export function reportFileName(m: Pick<ReportModel, "number" | "place">): string {
  const place = m.place.replace(/[^A-Za-z0-9 ]+/g, " ").trim().replace(/\s+/g, "-").slice(0, 40);
  return `${m.number}${place ? `-${place}` : ""}.pdf`;
}
