import { login } from "./actions";

export default function LoginPage({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const msg =
    searchParams.error === "inactivo" ? "Tu usuario está desactivado. Habla con el administrador." :
    searchParams.error ? "Correo o contraseña incorrectos." : null;
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form action={login} className="card w-full max-w-sm p-6 space-y-4">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Texas Top Roofing" width={656} height={508} className="mx-auto w-48 h-auto" />
          <h1 className="h1 mt-4">Entrar al CRM</h1>
        </div>
        {msg && <p className="rounded-lg bg-red-50 text-red-700 text-sm p-3">{msg}</p>}
        {searchParams.ok && <p className="rounded-lg bg-green-50 text-green-700 text-sm p-3">Contraseña guardada. Ya puedes entrar.</p>}
        <div>
          <label className="label" htmlFor="email">Correo</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Contraseña</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button className="btn-primary w-full">Entrar</button>
        <p className="muted">¿No tienes usuario? El administrador crea tu usuario y te da una contraseña temporal.</p>
      </form>
    </main>
  );
}
