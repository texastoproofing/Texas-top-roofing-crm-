# Auditoría de interfaces — Texas Top Roofing CRM

Rama: `rediseno-ui` · Fecha: 3 nov 2026 · Stack verificado: Next.js 14.2 (App Router, server actions), React 18, Tailwind 3.4, Supabase (Auth + RLS + Storage), Leaflet 1.9 (OpenStreetMap), Vercel.

## Roles y permisos (no se modifican)
- `administrador`: todo, incluye Usuarios, Importar Trello, ajustes de Tormentas, cargar dueños, borrar trabajos/contactos.
- `project_manager`, `asistente` (staff): ven todo el equipo en Agenda/Tareas, pueden borrar archivos de cualquiera.
- `vendedor`: ve sus trabajos (RLS `can_see_job`), sus tareas, todo lo meteorológico y las calles.

## Inventario de pantallas

| Módulo | Ruta | Función | Componentes | Problemas visuales / de uso | Prioridad | Riesgo |
|---|---|---|---|---|---|---|
| Shell | `app/(app)/layout.tsx` | Sidebar blanco fijo (desktop), header móvil con "Menú" y "Salir", barra inferior de 6 | `Nav.tsx` (SideNav, BottomNav, MobileMenu) | 6 pestañas apretadas (texto 10 px); "Salir" expuesto junto a Menú; menú móvil es un `<details>` flotante; sidebar sin categorías, sin colapsar | Alta | Bajo |
| Login | `/login` | Entrar | form | Correcto; falta jerarquía/branding | Media | Bajo |
| Contraseña | `/auth/set-password` | Cambiar contraseña | form | Igual que login | Baja | Bajo |
| Inicio | `/` | KPIs por etapa (4), citas de hoy, mis tareas, door-to-door, actividad | `Stat`, listas | Tarjetas grandes con mucho vacío; sin acciones rápidas; door-to-door sin "continuar"; sin pipeline/ranking en desktop | Alta | Bajo |
| Trabajos | `/trabajos` | Tablero por estado / lista, filtros por etapa, búsqueda, "solo míos" | `StatusSelect`, `StatusBadge` | Chips de filtros mezclados con cambio de vista; lista sin columnas en desktop (vendedor, valor, fecha) | Alta | Medio (estados del pipeline) |
| Trabajo | `/trabajos/[id]` | Estado, tareas, citas, actividad, referencias, seguro, montos, editar; pestaña Fotos y documentos | `ActivityFeed`, `TaskList`, `JobFields`, `JobFiles`, `JobReferences` | Cabecera densa; sin navegación por secciones; acciones repartidas | Alta | Medio |
| Nuevo trabajo | `/trabajos/nuevo` | Alta con prellenado desde contacto, calle o casa | `JobFields`, `Field`, `Select` | Formulario largo sin agrupación visual | Media | Medio |
| Contactos | `/contactos` | Lista + búsqueda + llamar | — | Solo "Llamar"; sin mensaje/abrir trabajo; sin tabla en desktop | Media | Bajo |
| Contacto | `/contactos/[id]`, `/contactos/nuevo` | Detalle, trabajos, notas, editar | `ContactFields`, `ActivityFeed` | Igual patrón que trabajo | Media | Bajo |
| Agenda | `/calendario` | 7 días por persona, cita sin trabajo | — | Días vacíos ocupan tarjeta completa ("Libre"); sin vista diaria/mensual | Media | Bajo |
| Tareas | `/tareas` | Mis pendientes / equipo / hechas, crear | `TaskList`, `TaskForm` | Sin separación de vencidas; sin prioridad (no existe en la base) | Media | Bajo |
| Mapa | `/mapa` | Clientes por estado, calles, zonas de granizo, ruta del día, por revisar | `MapApp`, `LeafletMap` | En móvil el mapa compite con 3 filas de chips; lista y fichas quedan debajo de la leyenda | Alta | Alto (no tocar lógica) |
| Calles | `/territorios`, `/territorios/[id]` | Zonas door-to-door por región, calles, puertas, leads, casas y dueños | `LoadOwners` | Tarjetas grandes; botones +1/+5/Lead/Mapa en grilla; sin progreso por vendedor | Alta | Medio |
| Tormentas | `/tormentas`, `/tormentas/importar` | Storm Intelligence (panel, mapa, ZIP, leads, eventos, alertas, ajustes) | `StormApp`, `StormMap` | Estilo propio con 7 pestañas; ya responsive | Media | Alto (cálculos) |
| Usuarios | `/usuarios` | Crear, editar rol, activar, contraseña | forms | Formularios en lista; sin tabla | Baja | Medio (permisos) |
| Importar Trello | `/importar` | Importación JSON | `Importer` | OK | Baja | Bajo |
| Estados | `error.tsx`, `not-found.tsx` | Error / no encontrado | — | Correctos, sin estilo de marca | Baja | Bajo |

## Lo que NO existe (no se crean entradas de menú)
Notificaciones generales, Leaderboard/Sales Performance, Comisiones, Finanzas (revenue/expenses/profit), Claims y Estimates como módulos separados, Supplements, Producción separada, Reports, Settings generales. Los datos de seguro, montos y producción viven dentro del trabajo (estados del pipeline). El ranking por vendedor existe dentro de Tormentas → Panel (rendimiento por vendedor).

Las "notificaciones" reales que existen son las **alertas de granizo** de Tormentas; la campana del encabezado lleva ahí.

## Plan de rediseño (sin cambiar lógica, datos, estados ni permisos)
1. Tokens de diseño (paleta corporativa, Inter, escala tipográfica, sombras, radios) en Tailwind + clases base.
2. AppShell: sidebar oscuro contraíble por categorías (solo rutas reales), encabezado móvil compacto con avatar y menú de perfil (cerrar sesión ahí), barra inferior Inicio / Trabajos / Mapa / Calles / Más, hoja de acciones rápidas.
3. Inicio: KPIs compactos, pipeline por etapa, ranking (solo staff, con montos aprobados que ya existen), citas, tareas, door-to-door con "continuar", actividad.
4. Trabajos, contactos, agenda, tareas, calles: componentes compartidos (encabezados, tarjetas de lista, badges, estados vacíos, barra de progreso).
5. Mapa: ajustes de diseño sin tocar la lógica del mapa.
6. Sin migraciones de base de datos.

## Cambios hechos en la rama `rediseno-ui` (fase 1)
- **Tokens**: paleta corporativa (#111318, #D71920, #F6F7F9, #17191F, #667085, #E6E8EC), Inter, sombras suaves, foco visible, `prefers-reduced-motion`.
- **Navegación escritorio**: barra lateral oscura de 256 px / 72 px contraída (se recuerda), grupos General · Ventas · Campo · Administración, botón Nuevo, perfil abajo con contraseña y cerrar sesión, contador de alertas de granizo.
- **Navegación móvil**: encabezado compacto (logo, campana de alertas, avatar con menú de cuenta; "Salir" ya no está expuesto), barra inferior Inicio · Trabajos · (+) · Mapa · Calles · Más. Se mantuvo Calles como pestaña porque es la tarea diaria del vendedor; Contactos, Agenda, Tareas, Tormentas y administración están en Más.
- **Acciones rápidas** (hoja inferior): nuevo lead, inspección, cita, tarea, registrar visita, contacto — todas llevan a flujos existentes.
- **Inicio**: KPIs reales (2 en móvil + "más indicadores"), pipeline por etapa, ranking del equipo (solo staff; firmado y aprobado separados), próximas citas, mis tareas, door-to-door con "Continuar" en la última calle trabajada, trabajos sin cambio en 14+ días, actividad.
- **Trabajos**: búsqueda con icono, "Solo míos", selector Tablero/Lista, etapas con color; lista = tabla en escritorio y tarjetas en móvil; tablero con columnas más limpias. Estados y transiciones sin cambios.
- **Trabajo**: cabecera con cliente, acciones Llamar/Mensaje/Ir/Cliente, navegación fija por secciones.
- **Contactos**: tabla en escritorio; tarjetas con Llamar/Mensaje/Abrir en móvil.
- **Agenda**: semana compacta por día (sin tarjetas vacías gigantes), "Nueva cita" abre el formulario (y preselecciona inspección desde acciones rápidas).
- **Tareas**: pestañas segmentadas, vencidas separadas.
- **Calles**: resumen general, tarjetas con progreso, detalle con progreso de la zona.
- **Mapa**: la ficha de cliente/calle aparece arriba del listado y la pantalla se desplaza a ella en celular; leyenda al final y plegada.
- **Login, usuarios, no encontrado**: mismo sistema visual.
- Sin migraciones de base de datos. Sin cambios de permisos, estados, cálculos ni integraciones.
