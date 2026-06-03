"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  label: string;
};

type Props = {
  center: { lat: number; lng: number } | null;
  radiusMiles: number;
  points: MapPoint[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
};

const MILES_TO_M = 1609.34;

export default function PropertyMap({
  center,
  radiusMiles,
  points,
  selectedIds,
  onToggle,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const centerLayer = useRef<L.LayerGroup | null>(null);
  const pointsLayer = useRef<L.LayerGroup | null>(null);
  // Keep the latest onToggle without re-binding every marker on each render.
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;

  // Init once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: [27.0, -80.5], // South FL default until we have a center
      zoom: 11,
      scrollWheelZoom: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    centerLayer.current = L.layerGroup().addTo(map);
    pointsLayer.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Recenter + draw the radius circle.
  useEffect(() => {
    const map = mapRef.current;
    const layer = centerLayer.current;
    if (!map || !layer || !center) return;
    layer.clearLayers();
    L.circleMarker([center.lat, center.lng], {
      radius: 7,
      color: "#dc2626",
      fillColor: "#dc2626",
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup("Search center")
      .addTo(layer);
    L.circle([center.lat, center.lng], {
      radius: radiusMiles * MILES_TO_M,
      color: "#2563eb",
      weight: 1,
      fillOpacity: 0.05,
    }).addTo(layer);
    map.setView([center.lat, center.lng], map.getZoom() < 11 ? 12 : map.getZoom());
  }, [center, radiusMiles]);

  // Draw result markers; rebuild on points/selection change.
  useEffect(() => {
    const map = mapRef.current;
    const layer = pointsLayer.current;
    if (!map || !layer) return;
    layer.clearLayers();

    points.forEach((p) => {
      const selected = selectedIds.has(p.id);
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 6,
        color: selected ? "#16a34a" : "#64748b",
        fillColor: selected ? "#16a34a" : "#94a3b8",
        fillOpacity: 0.9,
        weight: selected ? 3 : 1,
      });
      marker.bindPopup(p.label);
      marker.on("click", () => toggleRef.current(p.id));
      marker.addTo(layer);
    });

    // Fit to results the first time we have them + a center.
    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
      if (center) bounds.extend([center.lat, center.lng]);
      map.fitBounds(bounds.pad(0.15), { maxZoom: 15 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, selectedIds]);

  // `relative z-0` isolates Leaflet's internal z-indexes (panes/controls go up
  // to 1000) into their own stacking context so they can't paint over app
  // dropdowns/popovers that sit earlier in the DOM.
  return (
    <div
      ref={containerRef}
      className="relative z-0 h-[520px] w-full rounded-md border"
    />
  );
}
