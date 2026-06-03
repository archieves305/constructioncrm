// Canonical property shape returned by zylow.net's read-only API. The same
// shape appears on /property/{id}, each /comps record, and each /nearby result;
// `distance_miles` is present only on comps and nearby results.
// See the Zylow Partner Integration Guide.

export type ZylowPropertyRecord = {
  id: string; // REAPI property id
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  owner_name: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  year_built: number | null;
  property_type: string | null;
  roof_type: string | null;
  last_sale_date: string | null; // ISO date
  last_sale_amount: number | null;
  outstanding_mortgages: number | null;
  estimated_value: number | null;
  cached_at: string | null; // ISO timestamp — when Zylow last refreshed
  data_source?: string;
  distance_miles?: number | null; // comps + nearby only
};

export type ZylowWhoami = {
  label: string;
  scopes: string[];
  rate_limit_per_minute: number;
  expires_at: string | null;
  // Credit ceilings/usage (v2). Ceilings may be null = uncapped.
  credit_ceiling_monthly: number | null;
  credit_ceiling_total: number | null;
  credits_used_this_month: number;
  credits_used_total: number;
};

// Address typeahead — lightweight subset of the canonical shape. Cache-only.
export type ZylowAutocompleteResult = {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  cached_at: string | null;
};

export type ZylowAutocompleteResponse = {
  q: string;
  results: ZylowAutocompleteResult[];
  count: number;
  data_source: string;
};

export type ZylowCompsResponse = {
  id: string;
  comps: ZylowPropertyRecord[];
  count: number;
  cached_at: string | null;
  data_source?: string; // "zylow-cache" | "reapi-live"
  avm: { estimate: number | null; low: number | null; high: number | null } | null;
};

export type ZylowNearbyResponse = {
  results: ZylowPropertyRecord[];
  count: number;
  lat: number;
  lng: number;
  radius_miles: number;
  limit: number;
};

export type NearbyParams = {
  lat: number;
  lng: number;
  radiusMiles?: number;
  limit?: number;
};
