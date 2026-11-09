"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/fetch-json";
import { displayPhone } from "@/lib/crews/contact";

export type CrewContactCrew = { id: string; name: string; foremanName?: string | null; phone?: string | null; language?: string | null };

const LANG: Record<string, string> = { en: "English", es: "Español" };

/**
 * Who to reach on a labor contract's crew: the foreman, phone and language
 * that guest links go to. A contract typed by name is linked to a crew record
 * first (an existing crew, or a new one made from the name).
 */
export function CrewContact({ contractId, label, crew, canEdit, onChanged }: { contractId: string; label: string | null; crew: CrewContactCrew | null; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);

  if (!crew) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Not linked to a crew record, so it has no contact for crew links.</span>
        {canEdit ? (
          <Button size="sm" variant="outline" className="h-7" onClick={() => setLinking(true)}>
            Link to a crew…
          </Button>
        ) : null}
        {linking ? <LinkDialog contractId={contractId} label={label} onClose={() => setLinking(false)} onDone={onChanged} /> : null}
      </div>
    );
  }

  const hasContact = Boolean(crew.phone);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {hasContact ? (
        <>
          <span className="inline-flex items-center gap-1">
            <UserRound className="h-3 w-3" />
            {crew.foremanName || "Foreman not named"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Phone className="h-3 w-3" />
            {displayPhone(crew.phone)}
          </span>
          <span>{LANG[crew.language ?? "en"] ?? crew.language}</span>
        </>
      ) : (
        <span className="text-tone-warning-fg">No phone for this crew yet, so crew links cannot reach it.</span>
      )}
      {canEdit ? (
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(true)}>
          {hasContact ? "Edit contact" : "Add contact"}
        </Button>
      ) : null}
      {editing ? <ContactDialog crew={crew} onClose={() => setEditing(false)} onDone={onChanged} /> : null}
    </div>
  );
}

function ContactFields({ foreman, setForeman, phone, setPhone, language, setLanguage }: { foreman: string; setForeman: (v: string) => void; phone: string; setPhone: (v: string) => void; language: string; setLanguage: (v: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="crew-foreman">Foreman</Label>
        <Input id="crew-foreman" value={foreman} onChange={(e) => setForeman(e.target.value)} placeholder="Name of the person to reach" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="crew-phone">Mobile phone</Label>
        <Input id="crew-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(561) 555-0123" inputMode="tel" />
      </div>
      <div className="space-y-1">
        <Label>Language for links</Label>
        <div className="flex gap-2">
          {(["en", "es"] as const).map((l) => (
            <Button key={l} type="button" size="sm" variant={language === l ? "default" : "outline"} onClick={() => setLanguage(l)}>
              {LANG[l]}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ContactDialog({ crew, onClose, onDone }: { crew: CrewContactCrew; onClose: () => void; onDone: () => void }) {
  const [foreman, setForeman] = useState(crew.foremanName ?? "");
  const [phone, setPhone] = useState(displayPhone(crew.phone));
  const [language, setLanguage] = useState(crew.language ?? "en");
  const save = useMutation({
    mutationFn: () =>
      fetchJson(`/api/crews/${crew.id}/contact`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foremanName: foreman, phone, language }),
      }),
    onSuccess: () => {
      toast.success("Crew contact saved");
      onDone();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Could not save the contact"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contact for {crew.name}</DialogTitle>
        </DialogHeader>
        <ContactFields foreman={foreman} setForeman={setForeman} phone={phone} setPhone={setPhone} language={language} setLanguage={setLanguage} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkDialog({ contractId, label, onClose, onDone }: { contractId: string; label: string | null; onClose: () => void; onDone: () => void }) {
  const [query, setQuery] = useState(label ?? "");
  const [foreman, setForeman] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState("en");
  const crews = useQuery({ queryKey: ["crews", "active"], queryFn: () => fetchJson<CrewContactCrew[]>("/api/crews?activeOnly=true") });
  const link = useMutation({
    mutationFn: (body: object) =>
      fetchJson(`/api/labor-contracts/${contractId}/crew`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Linked to the crew");
      onDone();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Could not link the crew"),
  });
  const q = query.trim().toLowerCase();
  const matches = (crews.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 8);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link “{label}” to a crew</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="crew-search">An existing crew</Label>
          <Input id="crew-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search crews" />
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {crews.isPending ? <p className="text-xs text-muted-foreground">Loading crews…</p> : null}
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center justify-between rounded border px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => link.mutate({ crewId: c.id })}
                disabled={link.isPending}
              >
                <span>{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.phone ? displayPhone(c.phone) : "no phone"}</span>
              </button>
            ))}
            {crews.data && matches.length === 0 ? <p className="text-xs text-muted-foreground">No crew by that name.</p> : null}
          </div>
        </div>
        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">Or make a new crew named “{label}”</p>
          <ContactFields foreman={foreman} setForeman={setForeman} phone={phone} setPhone={setPhone} language={language} setLanguage={setLanguage} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => link.mutate({ createFromLabel: true, foremanName: foreman, phone, language })} disabled={link.isPending || !label}>
            {link.isPending ? "Saving…" : "Make the crew and link it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
