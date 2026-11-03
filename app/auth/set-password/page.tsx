import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function setPassword(fd: FormData) {
  "use server";
  const pw = String(fd.get("password") ?? "");
  if (pw.length < 8) redirect("/auth/set-password?error=corta");
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) redirect("/auth/set-password?error=1");
  redirect("/");
}

export default async function SetPasswordPage({ searchParams }: { searchParams: { error?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-canvas">
      <form action={setPassword} className="card w-full max-w-sm p-6 space-y-4">
        <a href="/" className="text-sm font-medium text-muted hover:text-ink">← Volver</a>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.png" alt="Texas Top Roofing" width={256} height={252} className="w-14 h-auto" />
        <h1 className="h1">Cambiar contraseña</h1>
        <p className="muted">{user.email}</p>
        {searchParams.error && (
          <p className="rounded-lg bg-red-50 text-red-700 text-sm p-3">
            {searchParams.error === "corta" ? "Usa al menos 8 caracteres." : "No se pudo guardar. Intenta de nuevo."}
          </p>
        )}
        <div>
          <label className="label" htmlFor="password">Nueva contraseña</label>
          <input className="input" id="password" name="password" type="password" minLength={8} autoComplete="new-password" required />
        </div>
        <button className="btn-primary w-full">Guardar</button>
      </form>
    </main>
  );
}
