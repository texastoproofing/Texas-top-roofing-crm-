"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card p-6 space-y-3">
      <h1 className="h2">No se pudo completar</h1>
      <p className="text-sm text-gray-700">{error.message || "Ocurrió un error."}</p>
      <p className="muted">Si dice “row-level security”, tu rol no tiene permiso para esa acción.</p>
      <button className="btn-primary" onClick={() => reset()}>Intentar de nuevo</button>
    </div>
  );
}
