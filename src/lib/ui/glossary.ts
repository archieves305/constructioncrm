/** Plain English for the words the trade uses and new staff do not. */
export const GLOSSARY = {
  sov: { term: "SOV", help: "Schedule of values — the contract split into billable line items, billed a little at a time on each payment application." },
  retainage: { term: "Retainage", help: "Money held back from each progress payment until the job is complete, then released." },
  paymentApplication: { term: "Payment application", help: "A progress bill: work completed to date, less retainage, less what was billed before." },
  nurture: { term: "Nurture", help: "Automatic check-in emails to open leads that have gone quiet." },
  costReconciliation: { term: "Cost reconciliation", help: "Matches card and bank postings from cc-allocator against job expenses so nothing is counted twice or missed." },
  knockScore: { term: "Knock score", help: "How promising a canvassed door looks, from its history and neighbourhood." },
  responseTimes: { term: "Response times", help: "How fast new web leads get their first call." },
  jurisdiction: { term: "Jurisdiction", help: "The city or county office that issues the permit." },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
