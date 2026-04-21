const STREET_ABBR: Record<string, string> = {
  street: "st",
  str: "st",
  avenue: "ave",
  av: "ave",
  boulevard: "blvd",
  road: "rd",
  drive: "dr",
  lane: "ln",
  court: "ct",
  place: "pl",
  terrace: "ter",
  trail: "trl",
  parkway: "pkwy",
  highway: "hwy",
  circle: "cir",
  square: "sq",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
  apartment: "apt",
  suite: "ste",
  unit: "unit",
  number: "",
};

export function normalizeAddressLine(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .replace(/[#.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => STREET_ABBR[tok] ?? tok)
    .join(" ")
    .trim();
}

export function normalizeZip(zip: string | null | undefined): string {
  return (zip ?? "").replace(/\D/g, "").slice(0, 5);
}

export function normalizeCity(city: string | null | undefined): string {
  return (city ?? "").trim().toLowerCase();
}

export type MatchInput = {
  address1: string;
  city: string;
  state: string;
  zip: string;
};

export type CandidateAddress = {
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export function scoreAddressMatch(
  target: MatchInput,
  candidate: CandidateAddress,
): number {
  const a = normalizeAddressLine(target.address1);
  const b = normalizeAddressLine(candidate.address1 ?? "");
  if (!a || !b) return 0;

  const zipSame = normalizeZip(target.zip) === normalizeZip(candidate.zip ?? "");
  const citySame = normalizeCity(target.city) === normalizeCity(candidate.city ?? "");
  const stateSame =
    (target.state ?? "").toUpperCase() === (candidate.state ?? "").toUpperCase();

  const aTokens = a.split(" ");
  const bTokens = b.split(" ");
  const targetNumber = aTokens[0];
  const candNumber = bTokens[0];
  const numberSame = Boolean(targetNumber) && targetNumber === candNumber;

  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let overlap = 0;
  for (const t of aSet) if (bSet.has(t)) overlap += 1;
  const tokenSim = overlap / Math.max(aSet.size, bSet.size);

  let score = 0;
  if (numberSame) score += 40;
  score += Math.round(tokenSim * 40);
  if (zipSame) score += 12;
  if (citySame) score += 5;
  if (stateSame) score += 3;
  return Math.min(100, score);
}
