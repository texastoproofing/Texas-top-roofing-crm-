import { requireAdmin } from "@/lib/auth";
import { ROLES, roleLabel } from "@/lib/constants";
import { PageHeader } from "@/components/ui";
import { createUser, resetPassword, updateUser } from "./actions";

const ERR: Record<string, string> = {
  datos: "Falta el correo o la contraseña tiene menos de 8 caracteres.",
  rol: "Rol no válido.",
  propio: "No puedes quitarte el rol de administrador ni desactivarte a ti mismo.",
};

export default async function UsersPage({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const { supabase, profile } = await requireAdmin();
  const { data } = await supabase.from("profiles").select("*").order("active", { ascending: false }).order("full_name");
  const users = data ?? [];
  const err = searchParams.error ? ERR[searchParams.error] ?? searchParams.error : null;

  return (
    <>
      <PageHeader title="Usuarios" sub={`${users.filter((u) => u.active).length} activos`} />
      {err && <p className="rounded-lg bg-red-50 text-red-700 text-sm p-3 mb-4">{err}</p>}
      {searchParams.ok && <p className="rounded-lg bg-green-50 text-green-700 text-sm p-3 mb-4">
        {searchParams.ok === "2" ? "Contraseña cambiada." : "Usuario creado. Pásale su correo y la contraseña temporal."}</p>}

      <details className="card p-4 mb-5" open={users.length <= 1}>
        <summary className="font-semibold text-brand cursor-pointer">+ Agregar usuario</summary>
        <form action={createUser} className="grid sm:grid-cols-2 gap-3 mt-3">
          <div><label className="label">Nombre completo</label><input className="input" name="full_name" required /></div>
          <div><label className="label">Correo</label><input className="input" name="email" type="email" required /></div>
          <div><label className="label">Teléfono</label><input className="input" name="phone" type="tel" /></div>
          <div>
            <label className="label">Rol</label>
            <select className="input" name="role" defaultValue="vendedor">
              {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Contraseña temporal (mín. 8)</label>
            <input className="input" name="password" minLength={8} required autoComplete="new-password" />
          </div>
          <button className="btn-primary sm:col-span-2">Crear usuario</button>
        </form>
      </details>

      <div className="card p-4 mb-5 text-sm text-gray-700 space-y-1">
        <p><b>Administrador:</b> todo, incluido borrar y manejar usuarios.</p>
        <p><b>Project manager</b> y <b>Asistente:</b> ven y editan todos los contactos, trabajos, tareas y citas.</p>
        <p><b>Vendedor:</b> solo ve sus propios contactos y trabajos (los que creó o tiene asignados). Todos ven los territorios.</p>
      </div>

      <ul className="space-y-3">
        {users.map((u) => (
          <li key={u.id} className={`card p-4 ${u.active ? "" : "opacity-60"}`}>
            <div className="flex justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold truncate">{u.full_name || u.email}{u.id === profile.id && " (tú)"}</div>
                <div className="muted truncate">{u.email}</div>
              </div>
              <span className="chip bg-gray-100 border-gray-200">{roleLabel(u.role)}{u.active ? "" : " · inactivo"}</span>
            </div>
            <details className="mt-2">
              <summary className="text-sm font-semibold text-gray-600 cursor-pointer">Editar</summary>
              <form action={updateUser.bind(null, u.id)} className="grid sm:grid-cols-2 gap-3 mt-3">
                <div><label className="label">Nombre</label><input className="input" name="full_name" defaultValue={u.full_name} /></div>
                <div><label className="label">Teléfono</label><input className="input" name="phone" defaultValue={u.phone ?? ""} /></div>
                <div>
                  <label className="label">Rol</label>
                  <select className="input" name="role" defaultValue={u.role}>
                    {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold mt-6">
                  <input type="checkbox" name="active" defaultChecked={u.active} className="w-5 h-5" /> Activo
                </label>
                <button className="btn-primary sm:col-span-2">Guardar</button>
              </form>
              <form action={resetPassword.bind(null, u.id)} className="flex gap-2 mt-3">
                <input className="input" name="password" minLength={8} placeholder="Nueva contraseña" required autoComplete="new-password" />
                <button className="btn-secondary shrink-0">Cambiar</button>
              </form>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
