import { login } from "./actions";

export default function LoginPage({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const msg =
    searchParams.error === "inactivo" ? "Tu usuario está desactivado. Habla con el administrador." :
    searchParams.error ? "Correo o contraseña incorrectos." : null;
  return (
    <main className="min-h-screen grid lg:grid-cols-2">
      <section className="hidden lg:flex flex-col justify-between bg-night text-white p-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-light.png" alt="Texas Top Roofing" width={656} height={508} className="w-40 h-auto" />
        <div>
          <h2 className="text-3xl font-semibold tracking-tight max-w-md">Leads, seguro, producción y calles en un solo lugar.</h2>
          <p className="mt-3 text-white/60 max-w-md">CRM interno de Texas Top Roofing para la oficina y el equipo en campo.</p>
        </div>
        <p className="text-xs text-white/40">Austin · San Antonio</p>
      </section>
      <section className="flex items-center justify-center px-4 py-10">
        <form action={login} className="w-full max-w-sm space-y-5">
          <div className="lg:hidden text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Texas Top Roofing" width={656} height={508} className="mx-auto w-40 h-auto" />
          </div>
          <div>
            <h1 className="h1">Entrar al CRM</h1>
            <p className="muted mt-1">Usa el correo y la contraseña que te dio el administrador.</p>
          </div>
          {msg && <p className="rounded-lg bg-red-50 text-red-700 text-sm p-3" role="alert">{msg}</p>}
          {searchParams.ok && <p className="rounded-lg bg-green-50 text-green-700 text-sm p-3" role="status">Contraseña guardada. Ya puedes entrar.</p>}
          <div>
            <label className="label" htmlFor="email">Correo</label>
            <input className="input" id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" required />
          </div>
          <div>
            <label className="label" htmlFor="password">Contraseña</label>
            <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button className="btn-primary w-full">Entrar</button>
          <p className="text-xs text-muted">¿No tienes usuario? El administrador lo crea y te da una contraseña temporal.</p>
        </form>
      </section>
    </main>
  );
}
