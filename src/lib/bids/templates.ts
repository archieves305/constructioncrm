/**
 * Follow-up email templates (PlanHub plan §6). Seeded into BidEmailTemplate
 * (create-only — an edited template is never reset) and filled by merge
 * alone: every value comes from the CRM's own records, never from a model,
 * so a draft can only name the amount that was actually sent. Pure.
 */

export type TemplateKey = "post_close_1" | "post_close_2" | "check_in" | "award_watch";

export type TemplateSeed = { key: TemplateKey; name: string; subject: string; body: string; autoSendable: boolean };

export const DEFAULT_TEMPLATES: readonly TemplateSeed[] = [
  {
    key: "post_close_1",
    name: "First follow-up after the bid",
    subject: "{{project}} — KNU Construction {{scopes}} proposal",
    body: [
      "Hi {{contactFirstName}},",
      "",
      "Following up on the {{scopes}} proposal KNU Construction sent for {{project}} on {{sentDate}} ({{amount}}).",
      "",
      "Is there anything you need from us to level our number — clarifications, alternates, or a breakdown? Happy to walk through it with you.",
      "",
      "Thank you,",
      "{{senderName}}",
      "KNU Construction",
      "{{senderPhone}}",
    ].join("\n"),
    autoSendable: false,
  },
  {
    key: "post_close_2",
    name: "Second follow-up",
    subject: "Checking in: {{project}} — {{scopes}}",
    body: [
      "Hi {{contactFirstName}},",
      "",
      "Checking in on {{project}}. Do you have a sense of when the owner will award, and when you expect to select subcontractors for {{scopes}}?",
      "",
      "Our proposal of {{sentDate}} ({{amount}}) stands. Let me know if anything has changed in the scope or schedule.",
      "",
      "Thank you,",
      "{{senderName}}",
      "KNU Construction",
      "{{senderPhone}}",
    ].join("\n"),
    autoSendable: false,
  },
  {
    key: "check_in",
    name: "Periodic check-in",
    subject: "{{project}} — status of {{scopes}}",
    body: [
      "Hi {{contactFirstName}},",
      "",
      "Any update on {{project}}? We remain interested in the {{scopes}} work and are available to review our number if the scope has changed.",
      "",
      "Thank you,",
      "{{senderName}}",
      "KNU Construction",
      "{{senderPhone}}",
    ].join("\n"),
    autoSendable: false,
  },
  {
    key: "award_watch",
    name: "Around the expected award",
    subject: "{{project}} — award timing",
    body: [
      "Hi {{contactFirstName}},",
      "",
      "I understand the owner expected to award {{project}} around now. Has a decision been made? If you are moving forward, we would like to talk through our {{scopes}} scope and schedule.",
      "",
      "Thank you,",
      "{{senderName}}",
      "KNU Construction",
      "{{senderPhone}}",
    ].join("\n"),
    autoSendable: false,
  },
];

/** Which template an email slot uses: the first email step, the second, then the check-in. */
export function templateKeyFor(slotKey: string, emailIndex: number): TemplateKey {
  if (slotKey.startsWith("award_watch:")) return "award_watch";
  if (emailIndex <= 0) return "post_close_1";
  if (emailIndex === 1) return "post_close_2";
  return "check_in";
}

export type MergeValues = {
  contactFirstName: string | null;
  project: string;
  scopes: string;
  amount: string | null;
  sentDate: string | null;
  senderName: string;
  senderPhone: string | null;
};

/**
 * Fill `{{field}}`s. A value the records do not have is never invented: the
 * clause carrying it is reworded ("Hi there," / "the proposal we sent"), and
 * an unknown field is left visible so the person sees it before sending.
 */
export function mergeTemplate(t: { subject: string; body: string }, v: MergeValues): { subject: string; body: string; missing: string[] } {
  const missing: string[] = [];
  const fill = (text: string) =>
    text
      .replace(" on {{sentDate}} ({{amount}})", v.sentDate && v.amount ? ` on ${v.sentDate} (${v.amount})` : v.sentDate ? ` on ${v.sentDate}` : v.amount ? ` (${v.amount})` : "")
      .replace(" of {{sentDate}} ({{amount}})", v.sentDate && v.amount ? ` of ${v.sentDate} (${v.amount})` : v.sentDate ? ` of ${v.sentDate}` : v.amount ? ` (${v.amount})` : "")
      .replace("Hi {{contactFirstName}},", v.contactFirstName ? `Hi ${v.contactFirstName},` : "Hi there,")
      .replace(/\n\{\{senderPhone\}\}/g, v.senderPhone ? `\n${v.senderPhone}` : "")
      .replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
        const val = (v as Record<string, string | null>)[key];
        if (val) return val;
        if (!missing.includes(key)) missing.push(key);
        return whole;
      });
  return { subject: fill(t.subject), body: fill(t.body), missing };
}
