import Link from "next/link";
export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-6 text-center space-y-3">
        <h1 className="h2">No encontrado</h1>
        <p className="muted">No existe o no tienes permiso para verlo.</p>
        <Link href="/" className="btn-primary">Ir al inicio</Link>
      </div>
    </main>
  );
}
