"use client";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { groupInfo, STREET_STATUS, type LatLng, type MapGroup } from "@/lib/map";
import { hailColor } from "@/lib/storm";

export type LeafPoint = { id: string; lat: number; lng: number; group: MapGroup; label: string; routeIndex: number | null; authorized: boolean };
export type LeafStreet = { id: string; status: string; visits: number; lines: [number, number][][]; label: string };
export type Bounds = { s: number; w: number; n: number; e: number };
export type HailLayer = {
  swaths: { geom: [number, number][]; min: number; label: string }[];
  reports: { lat: number; lng: number; size: number; label: string }[];
  zones: { zip: string; geom: [number, number][]; rank: number | null; mine: boolean; label: string }[];
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const AUSTIN: [number, number] = [30.4, -97.75]; // vista inicial solo si no hay puntos

function pinHtml(p: LeafPoint, selected: boolean) {
  const g = groupInfo(p.group);
  const ref = !!g.reference;
  const size = ref ? 34 : 26;
  const inner = p.routeIndex != null ? String(p.routeIndex + 1) : ref ? "★" : "";
  return `<div class="ttr-pin${ref ? " ttr-ref" : ""}${selected ? " ttr-sel" : ""}" style="--c:${g.color};width:${size}px;height:${size}px">${inner}</div>`;
}

export default function LeafletMap({
  points, streets, showStreets, selectedId, selectedStreetId, start, pickMode, focus, fitKey,
  tileUrl, tileAttribution, onSelect, onSelectStreet, onPick, onBounds, hail, fitBox, onZone,
}: {
  hail: HailLayer | null;
  fitBox: { bbox: number[]; key: number } | null;
  onZone: (zip: string) => void;
  points: LeafPoint[];
  streets: LeafStreet[];
  showStreets: boolean;
  selectedId: string | null;
  selectedStreetId: string | null;
  start: LatLng | null;
  pickMode: boolean;
  focus: { lat: number; lng: number; zoom?: number; key: number } | null;
  fitKey: string;
  tileUrl: string;
  tileAttribution: string;
  onSelect: (id: string) => void;
  onSelectStreet: (id: string) => void;
  onPick: (p: LatLng) => void;
  onBounds: (b: Bounds) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const st = useRef<any>({});
  const cb = useRef({ onSelect, onSelectStreet, onPick, onBounds, pickMode, onZone });
  cb.current = { onSelect, onSelectStreet, onPick, onBounds, pickMode, onZone };

  // Crear el mapa (solo en el navegador)
  useEffect(() => {
    let dead = false;
    (async () => {
      // Copia modificable del módulo (el plugin de grupos agrega funciones a L)
      const mod: any = await import("leaflet");
      const L: any = Object.assign({}, mod.default ?? mod);
      (window as any).L = L;
      await import("leaflet.markercluster");
      if (dead || !el.current || st.current.map) return;
      const map = L.map(el.current, { zoomControl: true }).setView(AUSTIN, 10);
      L.tileLayer(tileUrl, { maxZoom: 19, attribution: tileAttribution }).addTo(map);
      // Granizo debajo de calles y clientes
      map.createPane("hail"); map.getPane("hail").style.zIndex = 390;
      const hailLayer = L.layerGroup().addTo(map);
      const streetsLayer = L.layerGroup().addTo(map);
      const cluster = (L as any).markerClusterGroup({
        showCoverageOnHover: false, maxClusterRadius: 45, disableClusteringAtZoom: 17, spiderfyOnMaxZoom: true,
      }).addTo(map);
      const extra = L.layerGroup().addTo(map);
      map.on("moveend", () => {
        const b = map.getBounds();
        cb.current.onBounds({ s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() });
      });
      map.on("click", (e: any) => { if (cb.current.pickMode) cb.current.onPick({ lat: e.latlng.lat, lng: e.latlng.lng }); });
      st.current = { L, map, cluster, streetsLayer, extra, hailLayer, markers: new Map(), fitted: "" };
      st.current.ready = true;
      setTimeout(() => map.invalidateSize(), 50);
      draw();
    })();
    return () => { dead = true; if (st.current.map) { st.current.map.remove(); st.current = {}; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const s = st.current;
    if (!s.ready) return;
    const { L, map, cluster, streetsLayer, extra, hailLayer } = s;

    // Zonas de granizo (radar = estimado; puntos = reportes observados)
    hailLayer.clearLayers();
    if (hail) {
      for (const z of hail.zones) {
        L.polygon(z.geom, {
          pane: "hail", color: z.mine ? "#111827" : "#b91c1c", weight: z.mine ? 1 : z.rank != null && z.rank < 5 ? 0.8 : 0.4,
          opacity: z.mine ? 0.8 : z.rank != null && z.rank < 5 ? 0.5 : 0.25,
          dashArray: z.mine ? "5 4" : undefined, fillColor: "#dc2626", fillOpacity: z.rank != null && z.rank < 5 ? 0.12 : 0.04,
        }).bindTooltip(esc(z.label), { sticky: true })
          .on("click", (e: any) => { L.DomEvent.stopPropagation(e); if (!cb.current.pickMode) cb.current.onZone(z.zip); })
          .addTo(hailLayer);
      }
      for (const w of [...hail.swaths].sort((a, b) => a.min - b.min)) {
        L.polygon(w.geom, { pane: "hail", color: hailColor(w.min), weight: 0, opacity: 0, fillColor: hailColor(w.min), fillOpacity: 0.35, interactive: false }).addTo(hailLayer);
      }
      for (const r of hail.reports) {
        L.circleMarker([r.lat, r.lng], { pane: "hail", radius: 3 + Math.min(5, r.size * 1.5), weight: 1, color: "#fff", fillColor: "#111827", fillOpacity: 0.85 })
          .bindTooltip(esc(r.label)).addTo(hailLayer);
      }
    }

    // Calles
    streetsLayer.clearLayers();
    if (showStreets) {
      for (const street of streets) {
        const key = street.status === "pendiente" && street.visits > 0 ? "en_progreso" : street.status;
        const sty = STREET_STATUS[key] ?? STREET_STATUS.pendiente;
        const sel = street.id === selectedStreetId;
        for (const line of street.lines) {
          L.polyline(line, {
            color: sty.color, dashArray: sel ? undefined : sty.dash, interactive: false,
            // Pendientes: línea punteada muy fina para no tapar el mapa
            weight: sel ? 5 : key === "pendiente" ? 1 : 2.5, opacity: sel ? 1 : key === "pendiente" ? 0.45 : 0.8,
          }).addTo(streetsLayer);
          // línea invisible y gruesa para tocar fácil en el teléfono
          L.polyline(line, { color: "#000", weight: 22, opacity: 0 })
            .on("click", (e: any) => { L.DomEvent.stopPropagation(e); if (!cb.current.pickMode) cb.current.onSelectStreet(street.id); })
            .bindTooltip(street.label, { sticky: true, direction: "top" })
            .addTo(streetsLayer);
        }
      }
    }

    // Marcadores
    cluster.clearLayers();
    s.markers = new Map();
    for (const p of points) {
      const size = groupInfo(p.group).reference ? 34 : 26;
      const icon = L.divIcon({ className: "ttr-pin-wrap", html: pinHtml(p, p.id === selectedId), iconSize: [size + 12, size + 12], iconAnchor: [(size + 12) / 2, (size + 12) / 2] });
      const m = L.marker([p.lat, p.lng], { icon, title: p.label, keyboard: true, zIndexOffset: p.id === selectedId ? 1000 : groupInfo(p.group).reference ? 500 : 0 });
      m.on("click", () => { if (!cb.current.pickMode) cb.current.onSelect(p.id); });
      cluster.addLayer(m);
      s.markers.set(p.id, m);
    }

    // Punto de salida
    extra.clearLayers();
    if (start) {
      L.circleMarker([start.lat, start.lng], { radius: 9, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 })
        .bindTooltip("Salida", { permanent: false }).addTo(extra);
    }

    // Ajustar la vista cuando cambian los filtros
    if (s.fitted !== fitKey) {
      s.fitted = fitKey;
      const pts: [number, number][] = points.map((p) => [p.lat, p.lng]);
      if (showStreets) streets.forEach((x) => x.lines.forEach((l) => l.forEach((q) => pts.push(q))));
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
    }
  }

  useEffect(draw); // redibuja cuando cambian datos o selección

  useEffect(() => {
    const s = st.current;
    if (!s.ready || !focus) return;
    const m = s.markers.get(selectedId ?? "");
    if (m) s.cluster.zoomToShowLayer(m, () => {});
    else s.map.setView([focus.lat, focus.lng], focus.zoom ?? Math.max(s.map.getZoom(), 16));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  useEffect(() => {
    const s = st.current;
    if (!s.ready || !fitBox) return;
    const b = fitBox.bbox;
    s.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [20, 20], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitBox?.key]);

  return (
    <div className={`relative h-full w-full ${pickMode ? "cursor-crosshair" : ""}`}>
      <div ref={el} className="h-full w-full rounded-xl overflow-hidden z-0" role="application" aria-label="Mapa de clientes y calles" />
    </div>
  );
}
