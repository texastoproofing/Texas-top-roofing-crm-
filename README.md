# TTR CRM · Texas Top Roofing

CRM interno basado en la estructura de JobNimbus: **Contactos → Trabajos** con un workflow por etapas, tablero kanban, tareas, agenda, notas y datos del seguro en cada trabajo. Incluye **Calles door-to-door** con las 10 zonas de granizo de Leander y Cedar Park.

Tecnología: Next.js 14 + Supabase (base de datos, usuarios y seguridad) + Vercel (hosting). Funciona en el teléfono y se puede “instalar” en la pantalla de inicio.

## Etapa 1 (esta versión)

| Módulo | Qué hace |
|---|---|
| Inicio | Citas de hoy, mis tareas, trabajos por etapa, avance door-to-door, actividad reciente |
| Trabajos | Tablero por estado (desliza en el teléfono) o lista. Filtros por etapa, “solo míos” y búsqueda. Cambio de estado desde la tarjeta |
| Trabajo | Estado, tareas, citas, bitácora de actividad (cada cambio de estado queda registrado), datos del seguro (aseguradora, póliza, claim, DOL, ajustador) y montos |
| Contactos | Búsqueda, botones Llamar / Mensaje / Mapa, origen del lead y costo |
| Agenda | Semana de citas por persona, en hora de Texas |
| Tareas | Mis pendientes, todo el equipo (oficina), hechas |
| Calles | 10 zonas, 198 calles. +1 / +5 puertas, “+ Lead” en la calle, estado y notas |
| Usuarios | Solo administrador: crear usuarios con contraseña temporal, cambiar rol, desactivar |
| Fotos y documentos | En cada trabajo: tomar fotos con la cámara, subir varias fotos, PDF, Word y Excel (máx. 25 MB). Categorías: techo, estimado de la aseguradora, contrato, reporte de medidas y otros. Miniaturas, vista previa, descarga, descripción por foto, eliminar con confirmación y resumen de lo cargado |
| Importar Trello | Solo administrador: sube el JSON del tablero y crea contactos + trabajos |

Workflow (agrupado como en JobNimbus):

- **Lead:** Lead nuevo · Contactado · Inspección agendada · Inspeccionado
- **Seguro / Estimado:** Reclamo abierto · Cita con ajustador · Desk adjuster · Estimado enviado
- **Vendido:** Aprobado · Contrato firmado · Suplemento / PA / Appraisal
- **Producción:** Materiales pedidos · Instalación agendada · En instalación
- **Cobro:** Facturado · Pago parcial
- **Completado** · **Perdido** (Perdido, Reclamo denegado)

Listas de Trello → estado: COSTUMER → Lead nuevo · INSPECTION SCHEDULED → Inspección agendada · CLAIM OPEN → Reclamo abierto · DESK ADJUSTER → Desk adjuster · APPROVED → Aprobado · PA+APPRAISAL → Suplemento / PA / Appraisal.

### Roles y permisos (los aplica la base de datos, no solo la pantalla)

- **Administrador:** todo, incluido borrar y manejar usuarios. El **primer usuario que se registra** queda como administrador.
- **Project manager** y **Asistente:** ven y editan todos los contactos, trabajos, tareas y citas.
- **Vendedor:** solo ve los contactos y trabajos que creó o que tiene asignados. Todos ven los territorios.
- Nadie puede subirse de rol a sí mismo. Solo el administrador borra.

## Puesta en marcha (una sola vez, ~20 minutos)

### 1. Supabase
1. Crea una cuenta en [supabase.com](https://supabase.com) → **New project** (región: `East US` o `Central US`). Guarda la contraseña de la base de datos.
2. **SQL Editor → New query**: pega todo `supabase/migrations/0001_init.sql` → **Run**.
3. Nueva query: pega `supabase/migrations/0002_territorios.sql` → **Run** (carga las 10 zonas y 198 calles).
   Nueva query: pega `supabase/migrations/0003_archivos.sql` → **Run** (crea el almacenamiento privado `job-files` para fotos y documentos).
4. **Authentication → Sign In / Providers → Email**: deja Email activado y **desactiva “Allow new users to sign up”** (los usuarios los crea el administrador desde el CRM).
5. **Authentication → Users → Add user → Create new user**: tu correo y contraseña, marca *Auto Confirm User*. Este primer usuario queda como **administrador**.
6. **Project Settings → API**: copia `Project URL`, la llave `anon public` y la llave `service_role`.

### 2. Vercel
1. Entra a [vercel.com](https://vercel.com) con tu cuenta de GitHub → **Add New → Project** → elige el repositorio del CRM.
2. En **Environment Variables** agrega:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = llave anon
   - `SUPABASE_SERVICE_ROLE_KEY` = llave service_role (secreta; nunca la compartas)
3. **Deploy**. Al terminar te da una dirección tipo `https://ttr-crm.vercel.app`.

### 3. Local (opcional, para programadores)
```bash
cp .env.example .env.local   # y llena las llaves
npm install
npm run dev                  # http://localhost:3000
```

## Cómo probar la Etapa 1 (lista de verificación)

Haz esto desde el teléfono, en la dirección de Vercel:

1. **Entrar:** inicia sesión con tu usuario administrador. Debes ver *Inicio* con “Hola, …”.
2. **Usuarios:** Menú → Usuarios → crea un vendedor de prueba (correo inventado, contraseña de 8+). Aparece en la lista como *Vendedor*.
3. **Importar Trello:** en la computadora, Trello → tablero TEXAS TOP ROOFING → ⋯ → *Imprimir, exportar y compartir* → *Exportar como JSON*. En el CRM: Menú → Importar Trello → sube el archivo. Revisa la vista previa (≈23 tarjetas) → **Importar**. En *Trabajos* deben aparecer en sus columnas (p. ej. CLAIM OPEN → “Reclamo abierto”). Si lo importas dos veces, no se duplica.
4. **Lead door-to-door:** Calles → zona **A** → en *Signature Lane* toca **+1 puerta** (sube el contador y pasa a “En progreso”) → **+ Lead** → llena nombre y teléfono → *Crear trabajo*. Se abre el trabajo con la dirección de la calle; la calle ahora dice “1 leads”.
5. **Workflow:** en el trabajo cambia el estado a *Inspección agendada*. En *Actividad* aparece “Lead nuevo → Inspección agendada”. En *Trabajos* la tarjeta se movió de columna.
6. **Cita y tarea:** en el trabajo, *+ Agendar cita* para mañana a las 10:00. Ve a *Agenda*: aparece mañana a las 10:00. Agrega una tarea con vencimiento de ayer: en *Inicio* sale en rojo “Vencida”.
7. **Permisos:** cierra sesión y entra con el vendedor de prueba. **No** debe ver los clientes importados (son del administrador), solo lo que él cree o se le asigne. No ve *Usuarios* ni *Importar*. Si el administrador le asigna un trabajo (Editar trabajo → Vendedor), ya lo ve.
8. **Desactivar:** como administrador, desactiva al vendedor de prueba. Ya no puede entrar.

Si algo de esto no funciona, anota el número del paso y el mensaje que aparece.

## Datos de clientes
Los datos de los clientes viven solo en tu proyecto de Supabase. **No** se guardan en el repositorio (`.gitignore` bloquea `private/`, `*.private.sql` y `*.private.json`). No subas el JSON de Trello a GitHub.

### Fotos y documentos: cómo funciona por dentro
- Los archivos se guardan en el bucket **privado** `job-files` de Supabase Storage, en la ruta `<id del trabajo>/<id único>/<nombre>`. Sus datos (categoría, descripción, quién y cuándo) van en la tabla `job_files`.
- El navegador sube el archivo directo a Storage (con barra de progreso, sin el límite de 4.5 MB de Vercel) y después el servidor revisa que exista, que el tamaño y el tipo coincidan y que el usuario pueda ver el trabajo; si algo falla, borra el archivo.
- Ver, subir y descargar: quien puede ver el trabajo. Eliminar: oficina (admin, PM, asistente) o quien lo subió. Los enlaces de vista y descarga son firmados y vencen en 1 hora.
- Al borrar un trabajo o un contacto se borran también sus archivos. Las subidas abandonadas se limpian solas después de 1 hora.

## Próximas etapas
2. **Seguros:** suplementos línea por línea, cartas.
3. **Instalaciones:** órdenes de material, cuadrillas, calendario de producción.
4. **Finanzas:** facturas, pagos, comisiones, costo por lead y ROI por ZIP.
5. **Automatizaciones:** tareas automáticas al cambiar de estado, recordatorios por SMS/correo.

## Estructura
```
app/(app)/            páginas con sesión (inicio, trabajos, contactos, calendario, tareas, territorios, usuarios, importar)
app/login, app/auth   entrar y cambiar contraseña
components/           formularios y piezas de la interfaz
lib/                  constantes del workflow, formato de fechas/dinero, Supabase, lector de Trello
supabase/migrations/  esquema, seguridad (RLS) y territorios
```
