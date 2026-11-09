"use client";

import { useEffect, useRef, useState } from "react";
import { GUEST_TEXT, type GuestLanguage, type GuestPurpose } from "@/lib/guest/purposes";
import { downscalePhoto } from "@/lib/photo-utils";

type View = { purpose: GuestPurpose; language: GuestLanguage; street: string; crewName: string | null; recipientName: string | null; scope: string | null; when: string | null; photos: { min: number; max: number } };
type Picked = { key: string; blob: Blob; name: string; preview: string };

/** The crew's form: big buttons, photos straight from the camera, English or Spanish. */
export function GuestForm({ token, view }: { token: string; view: View }) {
  const [lang, setLang] = useState<GuestLanguage>(view.language);
  const t = GUEST_TEXT[lang];
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [answer, setAnswer] = useState<"yes" | "no" | "change" | null>(null);
  const [state, setState] = useState<"form" | "sending" | "sent" | "error">("form");
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  // Counted as opened only when the page actually runs (link previews do not).
  useEffect(() => {
    void fetch(`/api/g/${token}/opened`, { method: "POST" }).catch(() => undefined);
  }, [token]);

  const add = async (files: FileList | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    const room = view.photos.max - photos.length;
    const next: Picked[] = [];
    for (const f of list.slice(0, room)) {
      // Shrunk and re-drawn in the browser: smaller to send, and the photo's location data is left behind.
      const p = await downscalePhoto(f);
      next.push({ key: `${f.name}-${f.size}-${Math.random()}`, blob: p.blob, name: p.fileName, preview: URL.createObjectURL(p.blob) });
    }
    setPhotos((cur) => [...cur, ...next]);
  };

  const ready =
    photos.length >= view.photos.min &&
    (view.purpose !== "CREW_PAYMENT" || Number(amount.replace(/[$,\s]/g, "")) > 0) &&
    (view.purpose !== "INSTALL_CONFIRM" || answer !== null);

  const send = async () => {
    setState("sending");
    setError(null);
    const body: Record<string, unknown> = {};
    if (note.trim()) body.note = note.trim();
    if (view.purpose === "CREW_PAYMENT") body.amount = Math.round(Number(amount.replace(/[$,\s]/g, "")) * 100) / 100;
    if (view.purpose === "INSTALL_CONFIRM") body.answer = answer;
    const form = new FormData();
    form.set("answer", JSON.stringify(body));
    for (const p of photos) form.append("photos", new File([p.blob], p.name, { type: p.blob.type || "image/jpeg" }));
    try {
      const res = await fetch(`/api/g/${token}`, { method: "POST", body: form });
      if (res.ok) return setState("sent");
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      const key = data.error as keyof typeof t | undefined;
      setError(key && key in t && typeof t[key] === "string" ? (t[key] as string) : data.error || t.failed);
      setState("error");
    } catch {
      setError(t.failed);
      setState("error");
    }
  };

  if (state === "sent") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-subtle p-6">
        <div className="max-w-sm text-center">
          <p className="mb-2 text-5xl" aria-hidden>
            ✓
          </p>
          <p className="text-lg text-foreground">{t.sent}</p>
        </div>
      </main>
    );
  }

  const big = "w-full rounded-xl px-4 py-4 text-lg font-semibold";
  return (
    <main className="min-h-screen bg-surface-subtle">
      <div className="mx-auto max-w-md space-y-5 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold tracking-wide text-muted-foreground">KNU Construction</p>
            <h1 className="text-2xl font-bold text-foreground">{t.title[view.purpose]}</h1>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-border-strong text-sm" role="group" aria-label="Language">
            {(["en", "es"] as const).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={`px-3 py-2 ${lang === l ? "bg-foreground text-white" : "bg-white text-fg-secondary"}`}>
                {l === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1 rounded-xl bg-white p-4 shadow-sm">
          <p className="text-lg font-semibold text-foreground">{view.street}</p>
          {view.crewName ? <p className="text-fg-secondary">{view.crewName}</p> : null}
          {view.scope ? (
            <p className="text-sm text-fg-secondary">
              <span className="font-medium">{t.scope}:</span> {view.scope}
            </p>
          ) : null}
          {view.when ? (
            <p className="text-foreground">
              <span className="font-medium">{t.when}:</span> {view.when}
            </p>
          ) : null}
          <p className="pt-1 text-xs text-muted-foreground">{t.intro}</p>
        </div>

        {view.purpose === "CREW_PAYMENT" ? (
          <div className="space-y-1">
            <label htmlFor="amount" className="block text-base font-medium text-foreground">
              {t.amount}
            </label>
            <input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="4,000" className="w-full rounded-xl border border-border-strong bg-white px-4 py-4 text-2xl" />
            <p className="text-sm text-muted-foreground">{t.amountHelp}</p>
          </div>
        ) : null}

        {view.purpose === "INSTALL_CONFIRM" ? (
          <div className="space-y-3">
            {(
              [
                ["yes", t.yes, "bg-tone-success text-white"],
                ["no", t.no, "bg-white text-foreground border border-border-strong"],
                ["change", t.change, "bg-white text-foreground border border-border-strong"],
              ] as const
            ).map(([v, label, cls]) => (
              <button key={v} type="button" onClick={() => setAnswer(v)} aria-pressed={answer === v} className={`${big} ${cls} ${answer === v ? "ring-4 ring-tone-info" : ""}`}>
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {view.photos.max > 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => camera.current?.click()} className={`${big} bg-foreground text-white`} disabled={photos.length >= view.photos.max}>
                {t.takePhoto}
              </button>
              <button type="button" onClick={() => library.current?.click()} className={`${big} border border-border-strong bg-white text-foreground`} disabled={photos.length >= view.photos.max}>
                {t.addPhotos}
              </button>
            </div>
            <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void add(e.target.files).then(() => (e.target.value = ""))} />
            <input ref={library} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void add(e.target.files).then(() => (e.target.value = ""))} />
            {photos.length ? (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((p) => (
                  <button key={p.key} type="button" onClick={() => setPhotos((cur) => cur.filter((x) => x.key !== p.key))} className="relative aspect-square overflow-hidden rounded-lg" aria-label="Remove photo">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the crew's own photo */}
                    <img src={p.preview} alt="" className="h-full w-full object-cover" />
                    <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white">✕</span>
                  </button>
                ))}
              </div>
            ) : null}
            {view.photos.min > 0 && photos.length === 0 ? <p className="text-sm text-muted-foreground">{t.photosNeeded}</p> : null}
          </div>
        ) : null}

        <div className="space-y-1">
          <label htmlFor="note" className="block text-base font-medium text-foreground">
            {t.note}
          </label>
          <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} className="w-full rounded-xl border border-border-strong bg-white px-4 py-3 text-base" />
        </div>

        {error ? <p className="rounded-lg bg-tone-danger-soft p-3 text-tone-danger-fg">{error}</p> : null}
        <button type="button" onClick={() => void send()} disabled={!ready || state === "sending"} className={`${big} bg-tone-info text-white disabled:opacity-40`}>
          {state === "sending" ? t.sending : t.send}
        </button>
      </div>
    </main>
  );
}
