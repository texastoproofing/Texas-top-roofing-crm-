-- Regiones adicionales (San Antonio) y radar NEXRAD de NOAA como fuente ESTIMADA.
-- Los contornos ZIP y los datos de radar se cargan desde el CRM (Tormentas → Ajustes → Regiones).
insert into public.storm_sources (key, name, kind, url, notes) values
  ('nexrad', 'NOAA NEXRAD – detecciones de granizo por radar (índice de granizo, SWDI)', 'estimado',
   'https://www.ncei.noaa.gov/products/severe-weather-data-inventory',
   'Detecciones automáticas del radar (tamaño máximo estimado por celda de tormenta). Tiende a sobrestimar; no son mediciones en tierra.')
on conflict (key) do update set name = excluded.name, kind = excluded.kind, url = excluded.url, notes = excluded.notes;
