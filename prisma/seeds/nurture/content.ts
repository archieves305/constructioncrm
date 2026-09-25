/**
 * Default follow-up and nurture emails, version 1. Neutral drafts for
 * Richard to rewrite in Admin → Customer Nurture → Library; the seeder never
 * overwrites a row that has been edited there. Markdown bodies; merge
 * fields per TEMPLATE_VARIABLES ({{lead.firstName}}, {{assignedTo.firstName}},
 * {{company.brand}}, {{company.phone}} …). Every piece says "just reply" so
 * answers reach the rep (reply-to) and get logged.
 */
export type NurtureSeed = {
  seedKey: string;
  kind: "FOLLOW_UP" | "NURTURE";
  step?: number;
  subject: string;
  category?: string;
  sortOrder: number;
  body: string;
};

const SIGN = "\n\n{{assignedTo.firstName}}\n{{company.brand}} · {{company.phone}}";

export const NURTURE_SEEDS: NurtureSeed[] = [
  {
    seedKey: "fu-1",
    kind: "FOLLOW_UP",
    step: 1,
    sortOrder: 1,
    subject: "Did everything come through, {{lead.firstName}}?",
    body: `Hi {{lead.firstName}},

Just making sure the details we sent over for your project at {{lead.addressLine1}} arrived and open cleanly on your end.

If anything is unclear, or you want to walk through it together, reply to this email or call me — happy to go line by line.${SIGN}`,
  },
  {
    seedKey: "fu-2",
    kind: "FOLLOW_UP",
    step: 2,
    sortOrder: 2,
    subject: "Any questions on your project?",
    body: `Hi {{lead.firstName}},

Checking in on the project at {{lead.addressLine1}}. Most people have a couple of questions at this point — timing, what's included, how payments work — and a five-minute call usually clears them up.

Reply with a good time, or call me directly. I'm your contact for this one from start to finish.${SIGN}`,
  },
  {
    seedKey: "fu-3",
    kind: "FOLLOW_UP",
    step: 3,
    sortOrder: 3,
    subject: "Still here when you're ready",
    body: `Hi {{lead.firstName}},

No pressure from our side — the timing is yours. I wanted to make sure you know we're still here and the numbers we sent still stand.

If anything about the scope or budget has changed, tell me and I'll adjust the estimate rather than start over. Just reply to this email.${SIGN}`,
  },
  {
    seedKey: "fu-4",
    kind: "FOLLOW_UP",
    step: 4,
    sortOrder: 4,
    subject: "Checking in from {{company.brand}}",
    body: `Hi {{lead.firstName}},

A quick monthly check-in on the project at {{lead.addressLine1}}. If it's moved to the back burner, that's fine — reply "later" and I'll leave it there.

If it's back on the list, reply with a good time and we'll pick up where we left off. Estimates older than a few months may need a fresh look at material pricing, which I can turn around quickly.${SIGN}`,
  },
  {
    seedKey: "nu-about",
    kind: "NURTURE",
    category: "company",
    sortOrder: 10,
    subject: "Who you're working with at {{company.brand}}",
    body: `Hi {{lead.firstName}},

Since you're considering a project with us, here's a little about who we are.

{{company.brand}} is a licensed and insured South Florida contractor. We keep our crews small and consistent, so the people who start your job are the people who finish it, and one person — for you, that's {{assignedTo.firstName}} — stays your point of contact the whole way.

We'd rather earn a project by being straightforward than by being pushy: clear scope, clear pricing, and honest timelines. If you'd like references from recent projects like yours, just reply and ask.${SIGN}`,
  },
  {
    seedKey: "nu-what-to-expect",
    kind: "NURTURE",
    category: "process",
    sortOrder: 20,
    subject: "What to expect once your project starts",
    body: `Hi {{lead.firstName}},

People often ask what the first week of a project looks like, so here's the short version.

- **Before day one:** we confirm the schedule, order materials, and pull any permit that's included in the scope.
- **Day one:** the crew lead walks the site with you, confirms access and where materials will stage, and answers questions.
- **During:** we tidy up at the end of each day and keep you posted on progress and any surprises.
- **At the end:** a walkthrough together, any punch-list items fixed, then the final paperwork.

Questions about any of it? Reply here — it goes straight to {{assignedTo.firstName}}.${SIGN}`,
  },
  {
    seedKey: "nu-permits",
    kind: "NURTURE",
    category: "process",
    sortOrder: 30,
    subject: "Permits, explained in plain English",
    body: `Hi {{lead.firstName}},

Permits confuse almost everyone, so here's what actually happens.

A permit is the city or county's way of checking that work meets code. For roofing, structural, electrical and plumbing work it's required; for cosmetic work it usually isn't. When a permit is part of our scope, we apply for it, schedule the inspections, and meet the inspector on site — you don't have to manage any of it.

Two things worth knowing: inspections can add a few days to a schedule, and a permitted job is easier to insure and to sell with the house later. Both are why we recommend it whenever it applies.

Reply if you'd like to know what your project would need.${SIGN}`,
  },
  {
    seedKey: "nu-hurricane",
    kind: "NURTURE",
    category: "seasonal",
    sortOrder: 40,
    subject: "Getting your home ready for hurricane season",
    body: `Hi {{lead.firstName}},

A few things worth doing before the storms line up, whether or not you ever hire us:

- Walk the roof edge from the ground and look for lifted shingles or loose flashing.
- Clear gutters and downspouts so water has somewhere to go.
- Check that shutters or panels still fit and the hardware is where you think it is.
- Trim branches that overhang the roof.
- Photograph the house inside and out — it makes any insurance claim far easier.

If you spot something that worries you, reply and we'll take a look. No charge for an honest opinion.${SIGN}`,
  },
  {
    seedKey: "nu-maintenance",
    kind: "NURTURE",
    category: "tips",
    sortOrder: 50,
    subject: "Five roof and exterior checks worth doing this month",
    body: `Hi {{lead.firstName}},

Five quick checks that catch small problems before they become expensive ones:

1. **Ceilings and closets** — any new stains or bubbling paint mean water is getting in somewhere.
2. **Attic on a sunny day** — pinpricks of daylight are holes.
3. **Gutters** — granules collecting in them mean shingles are wearing.
4. **Stucco and siding** — hairline cracks are normal; cracks you can fit a coin in are not.
5. **Windows and doors** — run a hand around the frame on a windy day and feel for drafts.

Found something? Reply with a photo and {{assignedTo.firstName}} will tell you whether it can wait.${SIGN}`,
  },
  {
    seedKey: "nu-financing",
    kind: "NURTURE",
    category: "financing",
    sortOrder: 60,
    subject: "Ways to pay for a bigger project",
    body: `Hi {{lead.firstName}},

A project that's larger than the checking account doesn't have to wait. The options people use most:

- **Staged payments** — our standard schedule spreads the cost across deposit, progress and completion.
- **Home equity line or loan** — usually the lowest rate for owners with equity.
- **Contractor financing** — we can point you to lenders we've worked with; approvals are quick and the application is online.
- **Insurance** — for storm or water damage, a claim may cover much of the work; we can document what's needed.

We don't push any of these — reply if you'd like help thinking it through for your project.${SIGN}`,
  },
  {
    seedKey: "nu-warranty",
    kind: "NURTURE",
    category: "warranty",
    sortOrder: 70,
    subject: "How our warranty works",
    body: `Hi {{lead.firstName}},

Two warranties cover most projects, and it helps to know the difference.

The **workmanship warranty** is ours: if something we installed fails because of how it was installed, we come back and fix it. The **manufacturer's warranty** covers the materials themselves, and we register it in your name so it's yours.

What voids them is usually simple to avoid: work by other trades on the same area, changes made without telling us, and skipping basic maintenance. We put the details in writing in every agreement so there's nothing to guess at.

Questions? Reply and ask.${SIGN}`,
  },
  {
    seedKey: "nu-referral",
    kind: "NURTURE",
    category: "referral",
    sortOrder: 80,
    subject: "Know someone who needs a hand?",
    body: `Hi {{lead.firstName}},

Most of our work comes from people telling their neighbors, so here's a small ask: if you know someone weighing a roof, a renovation, or storm repairs, we'd be glad to give them the same straight answers we've given you.

Just reply with their name, or pass along {{company.phone}}. No obligation on anyone's part — and if you'd rather we didn't ask, say so and we won't again.${SIGN}`,
  },
];

export const NURTURE_SEED_VERSION = 1;
