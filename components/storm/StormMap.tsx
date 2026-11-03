"use client";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

export type MapLayers = { swaths: boolean; hail: boolean; wind: boolean; zips: boolean; leads: boolean; territories: boolean };
export type SwathShape = { id: string; geom: [number, number][]; min: number; date: string };
export type EventDot = { id: string; lat: number; lng: number; type: "granizo" | "viento"; label: string; size: number | null };
export type ZipShape = { zip: string; geom: [number, number][]; score: number; label: string; assignedTo: string | null };
export type LeadDot = { id: string; lat: number; lng: number; color: string; label: string };

export const swathColor = (min: number) => (min >= 2.75 ? "#7f1d1d" : min >= 2.25 ? "#dc2626" : min >= 2 ? "#f97316" : "#f59e0b");

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export default function StormMap({ layers, swaths, events, zips, leads, fitKey, focus, tileUrl, tileAttribution, onZip, onEvent, onLead }: {
  layers: MapLayers; swaths: SwathShape[]; events: EventDot[]; zips: ZipShape[]; leads: LeadDot[];
  fitKey: string; focus: { lat: number; lng: number; zoom?: number; key: number } | null;
  tileUrl: string; tileAttribution: string;
  onZip: (zip: string) => void; onEvent: (id: string) => void; onLead: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const st = useRef<any>({});
  const cb = useRef({ onZip, onEvent, onLead });
  cb.current = { onZip, onEvent, onLead };

  useEffect(() => {
    let dead = false;
    (async () => {
      const mod: any = await import("leaflet");
      const L: any = Object.assign({}, mod.default ?? mod);
      (window as any).L = L;
      await import("leaflet.markercluster");
      if (dead || !el.current || st.current.map) return;
      const map = L.map(el.current, { zoomControl: true, preferCanvas: true }).setView([30.4, -97.75], 9);
      L.tileLayer(tileUrl, { maxZoom: 19, attribution: tileAttribution }).addTo(map);
      st.current = {
        L, map,
        zipL: L.layerGroup().addTo(map), terrL: L.layerGroup().addTo(map), swathL: L.layerGroup().addTo(map),
        evL: L.layerGroup().addTo(map), leadL: L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 40, disableClusteringAtZoom: 15 }).addTo(map),
        fitted: "", ready: true,
      };
      setTimeout(() => map.invalidateSize(), 50);
      draw();
    })();
    return () => { dead = true; if (st.current.map) { st.current.map.remove(); st.current = {}; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const s = st.current;
    if (!s.ready) return;
    const { L, map } = s;
    s.zipL.clearLayers(); s.terrL.clearLayers(); s.swathL.clearLayers(); s.evL.clearLayers(); s.leadL.clearLayers();

    if (layers.zips) {
      for (const z of zips) {
        const a = Math.min(0.55, (z.score / 100) * 0.6);
        L.polygon(z.geom, { color: "#6b7280", weight: 1, fillColor: "#c8102e", fillOpacity: a })
          .bindTooltip(esc(z.label), { sticky: true })
          .on("click", () => cb.current.onZip(z.zip)).addTo(s.zipL);
      }
    }
    if (layers.territories) {
      for (const z of zips.filter((x) => x.assignedTo)) {
        L.polygon(z.geom, { color: "#111827", weight: 3, dashArray: "6 4", fill: false, interactive: false })
          .bindTooltip(`${z.zip} · ${esc(z.assignedTo!)}`, { permanent: false }).addTo(s.terrL);
      }
    }
    if (layers.swaths) {
      for (const w of [...swaths].sort((a, b) => a.min - b.min)) {
        L.polygon(w.geom, { color: swathColor(w.min), weight: 1, fillColor: swathColor(w.min), fillOpacity: 0.35 })
          .bindTooltip(`Radar (estimado): ${w.min.toFixed(2)}"+ · ${w.date}`, { sticky: true })
          .addTo(s.swathL);
      }
    }
    for (const e of events) {
      if ((e.type === "granizo" && !layers.hail) || (e.type === "viento" && !layers.wind)) continue;
      const r = e.type === "granizo" ? 3 + Math.min(5, (e.size ?? 1) * 1.5) : 4;
      L.circleMarker([e.lat, e.lng], {
        radius: r, weight: 1, color: "#fff",
        fillColor: e.type === "granizo" ? "#111827" : "#2563eb", fillOpacity: 0.85,
      }).bindTooltip(esc(e.label)).on("click", () => cb.current.onEvent(e.id)).addTo(s.evL);
    }
    if (layers.leads) {
      for (const l of leads) {
        const icon = L.divIcon({ className: "ttr-pin-wrap", html: `<div class="ttr-pin" style="--c:${l.color};width:22px;height:22px"></div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
        L.marker([l.lat, l.lng], { icon, title: l.label }).on("click", () => cb.current.onLead(l.id)).addTo(s.leadL);
      }
    }

    if (s.fitted !== fitKey) {
      s.fitted = fitKey;
      const pts: [number, number][] = [];
      if (layers.leads) leads.forEach((l) => pts.push([l.lat, l.lng]));
      events.forEach((e) => pts.push([e.lat, e.lng]));
      if (pts.length < 2 && layers.zips) zips.forEach((z) => pts.push(...z.geom));
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [20, 20], maxZoom: 13 });
    }
  }

  useEffect(draw);

  useEffect(() => {
    const s = st.current;
    if (s.ready && focus) s.map.setView([focus.lat, focus.lng], focus.zoom ?? 13);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  return <div ref={el} className="h-full w-full rounded-xl overflow-hidden z-0" role="application" aria-label="Mapa de tormentas" />;
}
