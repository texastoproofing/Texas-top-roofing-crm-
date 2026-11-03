import { getSession, listProfiles } from "@/lib/auth";
import { todayTX } from "@/lib/format";
import { DEFAULT_WEIGHTS, type StormJob } from "@/lib/storm";
import { StormApp } from "@/components/storm/StormApp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function TormentasPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { supabase, profile } = await getSession();
  const [settingsRes, zipsRes, statsRes, swathsRes, eventsRes, assignRes, alertsRes, syncRes, jobsRes, users] = await Promise.all([
    supabase.from("storm_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("zip_boundaries").select("zip, name, geom, bbox"),
    supabase.from("zip_hail_stats").select("zip, event_date, source_key, max_hail_in, frac_1, frac_175, frac_25"),
    supabase.from("storm_swaths").select("id, source_key, event_date, min_hail_in, geom, bbox"),
    supabase.from("storm_events").select("id, source_key, event_type, event_date, observed_at, lat, lng, hail_in, wind_mph, location_text, county, zip, data_quality, precision_note, published_at").order("event_date", { ascending: false }).limit(10000),
    supabase.from("zip_assignments").select("id, zip, rep_id, starts_on, ends_on, rep:profiles!zip_assignments_rep_id_fkey(full_name)").order("starts_on", { ascending: false }),
    supabase.from("storm_alerts").select("id, title, zips, leads_nearby, is_realtime, status, created_at, event:storm_events(event_date, event_type, hail_in, wind_mph, lat, lng, source_key)").order("created_at", { ascending: false }).limit(100),
    supabase.from("storm_sync_jobs").select("id, range_start, range_end, status, inserted, skipped, error, started_at, finished_at").order("started_at", { ascending: false }).limit(15),
    supabase.from("jobs").select("id, number, status, job_type, address, city, zip, sales_rep_id, contact:contacts(first_name, last_name, address, city, zip), rep:profiles!jobs_sales_rep_id_fkey(full_name), location:job_locations(status, lat, lng)").limit(3000),
    listProfiles(),
  ]);

  if (settingsRes.error || zipsRes.error) {
    return (
      <div className="card p-6 text-sm text-red-700 bg-red-50">
        El módulo de tormentas no está instalado. Corre <code>supabase/migrations/0005_tormentas.sql</code> y <code>0006_tormentas_datos.sql</code> en Supabase.
      </div>
    );
  }

  const jobs: StormJob[] = (jobsRes.data ?? []).map((j: any) => {
    const c = one<any>(j.contact), loc = one<any>(j.location);
    return {
      id: j.id, number: j.number,
      customer: [c?.first_name, c?.last_name].filter(Boolean).join(" ") || "Sin nombre",
      address: [j.address ?? c?.address, j.city ?? c?.city, j.zip ?? c?.zip].filter(Boolean).join(", "),
      zip: (j.zip ?? c?.zip ?? null) || null,
      status: j.status, job_type: j.job_type, repId: j.sales_rep_id, repName: one<any>(j.rep)?.full_name ?? null,
      lat: loc?.status === "ok" ? loc.lat : null, lng: loc?.status === "ok" ? loc.lng : null,
    };
  });

  const s = settingsRes.data!;
  return (
    <StormApp
      isAdmin={profile.role === "administrador"}
      today={todayTX()}
      settings={{
        weights: { ...DEFAULT_WEIGHTS, ...(s.weights ?? {}) },
        alert_min_hail_in: Number(s.alert_min_hail_in), alert_min_wind_mph: Number(s.alert_min_wind_mph),
        history_start: s.history_start, updated_at: s.updated_at,
      }}
      zips={(zipsRes.data ?? []) as any}
      stats={(statsRes.data ?? []).map((x: any) => ({ ...x, max_hail_in: Number(x.max_hail_in), frac_1: Number(x.frac_1), frac_175: Number(x.frac_175), frac_25: Number(x.frac_25) }))}
      swaths={(swathsRes.data ?? []).map((x: any) => ({ ...x, min_hail_in: Number(x.min_hail_in) }))}
      events={(eventsRes.data ?? []).map((x: any) => ({ ...x, hail_in: x.hail_in == null ? null : Number(x.hail_in) }))}
      assignments={(assignRes.data ?? []).map((a: any) => ({ id: a.id, zip: a.zip, rep_id: a.rep_id, rep_name: one<any>(a.rep)?.full_name ?? null, starts_on: a.starts_on, ends_on: a.ends_on }))}
      alerts={(alertsRes.data ?? []).map((a: any) => ({ ...a, event: one<any>(a.event) }))}
      syncJobs={(syncRes.data ?? []) as any}
      jobs={jobs}
      users={users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.full_name, role: u.role }))}
      initial={searchParams}
      tileUrl={process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png"}
      tileAttribution={process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}
    />
  );
}
