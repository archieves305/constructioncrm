/**
 * Calculate great-circle distance in miles using Haversine formula
 * ~0.5% error vs geodesic, fine for sub-30-mile route planning
 */
export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.7613; // Earth's radius in miles
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);

  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface Stop {
  id: string;
  lat: number | null;
  lng: number | null;
  sortOrder: number;
}

export interface OptimizeResult {
  orderedStops: Stop[];
  totalMiles: number;
}

/**
 * O(n²) nearest-neighbor TSP approximation
 * Not optimal but close enough for 10-30 stop field routes
 * Falls back to input order for invalid coords
 */
export function nearestNeighborTSP(
  stops: Stop[],
  options: {
    startLat?: number;
    startLng?: number;
    returnToStart?: boolean;
  } = {}
): OptimizeResult {
  if (stops.length === 0) {
    return { orderedStops: [], totalMiles: 0 };
  }

  // Filter stops with valid coordinates
  const validStops = stops.filter(
    (s) => s.lat !== null && s.lng !== null && !isNaN(s.lat!) && !isNaN(s.lng!)
  );

  if (
    validStops.length < 2 &&
    options.startLat === undefined
  ) {
    // Not enough valid stops to optimize, return in original order
    return {
      orderedStops: stops,
      totalMiles: 0,
    };
  }

  const remaining = [...validStops];
  const ordered: Stop[] = [];
  let totalMiles = 0;

  // If start point provided, pick nearest stop to start
  if (
    options.startLat !== undefined &&
    options.startLng !== undefined &&
    remaining.length > 0
  ) {
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const stop = remaining[i];
      const dist = haversineMiles(
        options.startLat,
        options.startLng,
        stop.lat!,
        stop.lng!
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    totalMiles += bestDist;
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  } else if (remaining.length > 0) {
    // No start point, begin with first stop
    ordered.push(remaining.shift()!);
  }

  // Greedily pick nearest remaining stop
  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const stop = remaining[i];
      const dist = haversineMiles(current.lat!, current.lng!, stop.lat!, stop.lng!);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    totalMiles += bestDist;
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }

  // If round trip, add return leg to start
  if (
    options.returnToStart &&
    options.startLat !== undefined &&
    options.startLng !== undefined &&
    ordered.length > 0
  ) {
    const last = ordered[ordered.length - 1];
    totalMiles += haversineMiles(
      last.lat!,
      last.lng!,
      options.startLat,
      options.startLng
    );
  }

  // Append stops without coordinates at the end
  const missingCoords = stops.filter(
    (s) => s.lat === null || s.lng === null || isNaN(s.lat!) || isNaN(s.lng!)
  );

  // Update sortOrder for optimized route
  const finalStops = [...ordered, ...missingCoords].map((stop, index) => ({
    ...stop,
    sortOrder: index,
  }));

  return {
    orderedStops: finalStops,
    totalMiles: Math.round(totalMiles * 100) / 100, // Round to 2 decimals
  };
}

/**
 * Build Google Maps URL for turn-by-turn directions
 * Supports multi-stop routes with origin, destination, and waypoints
 */
export function buildGoogleMapsUrl(
  stops: Array<{ lat: number | null; lng: number | null }>,
  options: {
    startLatitude?: number | null;
    startLongitude?: number | null;
    isRoundTrip?: boolean;
  } = {}
): string | null {
  const withCoords = stops.filter(
    (s) => s.lat !== null && s.lng !== null && !isNaN(s.lat!) && !isNaN(s.lng!)
  );

  if (withCoords.length === 0) return null;

  const hasStart =
    options.startLatitude !== null &&
    options.startLatitude !== undefined &&
    options.startLongitude !== null &&
    options.startLongitude !== undefined;
  const roundTrip = options.isRoundTrip ?? false;

  let origin: { lat: number; lng: number };
  let dest: { lat: number; lng: number };
  let waypointStops: typeof withCoords;

  if (hasStart) {
    origin = {
      lat: options.startLatitude!,
      lng: options.startLongitude!,
    };
    if (roundTrip) {
      dest = origin;
      waypointStops = withCoords;
    } else {
      dest = {
        lat: withCoords[withCoords.length - 1].lat!,
        lng: withCoords[withCoords.length - 1].lng!,
      };
      waypointStops = withCoords.slice(0, -1);
    }
  } else {
    origin = {
      lat: withCoords[0].lat!,
      lng: withCoords[0].lng!,
    };
    dest = {
      lat: withCoords[withCoords.length - 1].lat!,
      lng: withCoords[withCoords.length - 1].lng!,
    };
    waypointStops = withCoords.slice(1, -1);
  }

  const waypoints = waypointStops
    .map((s) => `${s.lat},${s.lng}`)
    .join("|");
  let url =
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${origin.lat},${origin.lng}` +
    `&destination=${dest.lat},${dest.lng}` +
    `&travelmode=driving`;

  if (waypoints) {
    url += `&waypoints=${encodeURIComponent(waypoints)}`;
  }

  return url;
}
