import { z } from "zod";

/**
 * What a guest link may ask of a crew. Pure, client-safe. Each purpose has its
 * own answer, lifetime and wording (English / Spanish); nothing a crew sends
 * takes effect until a person in the office accepts it.
 */
export const GUEST_PURPOSES = ["CREW_PHOTOS", "CREW_PAYMENT", "INSTALL_CONFIRM"] as const;
export type GuestPurpose = (typeof GUEST_PURPOSES)[number];
export type GuestLanguage = "en" | "es";

const HOUR = 3_600_000;
/** How long a link stays open: confirmations 72 hours, photos and payment 7 days. */
export const LINK_LIFETIME_MS: Record<GuestPurpose, number> = {
  CREW_PHOTOS: 7 * 24 * HOUR,
  CREW_PAYMENT: 7 * 24 * HOUR,
  INSTALL_CONFIRM: 72 * HOUR,
};
export const MAX_GUEST_PHOTOS = 10;
export const MAX_GUEST_PHOTO_BYTES = 15 * 1024 * 1024;

export type LinkState = "open" | "expired" | "revoked" | "used";

export function linkState(l: { expiresAt: Date; revokedAt: Date | null; submittedAt: Date | null }, now: Date): LinkState {
  if (l.revokedAt) return "revoked";
  if (l.submittedAt) return "used";
  if (l.expiresAt.getTime() <= now.getTime()) return "expired";
  return "open";
}

/** The answer each purpose takes (photos travel beside it). */
export const answerSchemas = {
  CREW_PHOTOS: z.object({ note: z.string().trim().max(1000).optional() }),
  CREW_PAYMENT: z.object({ amount: z.number().positive().max(1_000_000), note: z.string().trim().max(1000).optional() }),
  INSTALL_CONFIRM: z.object({ answer: z.enum(["yes", "no", "change"]), note: z.string().trim().max(1000).optional() }),
} as const;

/** Photos a purpose needs: at least one for progress photos; optional otherwise. */
export function photosNeeded(p: GuestPurpose): { min: number; max: number } {
  if (p === "CREW_PHOTOS") return { min: 1, max: MAX_GUEST_PHOTOS };
  if (p === "CREW_PAYMENT") return { min: 0, max: MAX_GUEST_PHOTOS };
  return { min: 0, max: 0 };
}

/** The text the office sends with a link, in the crew's language. */
export function linkMessage(p: GuestPurpose, lang: GuestLanguage, v: { name?: string | null; street: string; url: string; when?: string | null }): string {
  const hi = v.name ? (lang === "es" ? `Hola ${v.name}, ` : `Hi ${v.name}, `) : lang === "es" ? "Hola, " : "Hi, ";
  const ask: Record<GuestPurpose, Record<GuestLanguage, string>> = {
    CREW_PHOTOS: { en: `please send photos of your work at ${v.street}`, es: `por favor envíe fotos de su trabajo en ${v.street}` },
    CREW_PAYMENT: { en: `you can request payment for ${v.street} here, with photos of the work`, es: `puede pedir su pago para ${v.street} aquí, con fotos del trabajo` },
    INSTALL_CONFIRM: {
      en: `please confirm you can be at ${v.street}${v.when ? ` on ${v.when}` : ""}`,
      es: `por favor confirme que puede estar en ${v.street}${v.when ? ` el ${v.when}` : ""}`,
    },
  };
  const tail = lang === "es" ? " — KNU Construction" : " — KNU Construction";
  return `${hi}${ask[p][lang]}: ${v.url}${tail}`;
}

/** The guest page's words. */
export const GUEST_TEXT = {
  en: {
    title: { CREW_PHOTOS: "Send photos of the work", CREW_PAYMENT: "Request a payment", INSTALL_CONFIRM: "Confirm the day" },
    intro: "From KNU Construction. Only the office sees what you send.",
    addPhotos: "Add photos",
    takePhoto: "Take photo",
    photosNeeded: "Add at least one photo.",
    note: "Note (optional)",
    amount: "Amount to request ($)",
    amountHelp: "For the work finished so far on this job.",
    yes: "Yes, I'll be there",
    no: "I can't make it",
    change: "I need a different day",
    send: "Send",
    sending: "Sending…",
    sent: "Sent. Thank you — the office will review it.",
    expired: "This link has expired. Ask the office for a new one.",
    used: "This link was already used. Ask the office if you need to send more.",
    revoked: "This link is no longer active. Ask the office for a new one.",
    notFound: "This link is not valid. Ask the office for a new one.",
    failed: "That didn't send. Check your signal and try again.",
    when: "Day",
    scope: "Work",
  },
  es: {
    title: { CREW_PHOTOS: "Enviar fotos del trabajo", CREW_PAYMENT: "Pedir un pago", INSTALL_CONFIRM: "Confirmar el día" },
    intro: "De KNU Construction. Solo la oficina ve lo que envíe.",
    addPhotos: "Agregar fotos",
    takePhoto: "Tomar foto",
    photosNeeded: "Agregue al menos una foto.",
    note: "Nota (opcional)",
    amount: "Monto a pedir ($)",
    amountHelp: "Por el trabajo terminado hasta ahora en este trabajo.",
    yes: "Sí, estaré allí",
    no: "No puedo ir",
    change: "Necesito otro día",
    send: "Enviar",
    sending: "Enviando…",
    sent: "Enviado. Gracias — la oficina lo revisará.",
    expired: "Este enlace venció. Pida uno nuevo a la oficina.",
    used: "Este enlace ya se usó. Pregunte a la oficina si necesita enviar más.",
    revoked: "Este enlace ya no está activo. Pida uno nuevo a la oficina.",
    notFound: "Este enlace no es válido. Pida uno nuevo a la oficina.",
    failed: "No se envió. Revise su señal e intente de nuevo.",
    when: "Día",
    scope: "Trabajo",
  },
} as const;
