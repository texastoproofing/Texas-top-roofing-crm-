-- Territorios door-to-door: franja de granizo del 28 de mayo de 2025 (radar HailPoint)
-- 10 zonas, Leander (78641) y Cedar Park (78613). Sin datos personales: se puede versionar.

insert into public.territories (code,name,city,zip,hail,storm_date,priority,schedule,description) values ('A','Fairways y Cap Rock at Crystal Falls','Leander','78641','3.00–3.25″','2025-05-28',1,'Lunes','Entre Crystal Falls Pkwy y N Lakeline Blvd, al sur del campo de golf') on conflict (code) do nothing;
insert into public.territory_streets (territory_id,name,position)
select t.id, v.name, v.pos from public.territories t, (values
  ('Signature Lane',0),
  ('Champions Corner Drive',1),
  ('Champions Corner Court',2),
  ('Long Bow Drive',3),
  ('Harvest Dance Drive',4),
  ('Cantina Sky Drive',5),
  ('Alamo Bound',6),
  ('Arroyo',7),
  ('Quarry Loop',8),
  ('Highland Trail',9),
  ('Wolf Dancer',10),
  ('Quick Fort',11),
  ('Wildcatter',12),
  ('Cross Draw',13),
  ('Outlook Ridge Loop',14),
  ('Lookout Range Drive',15),
  ('Shumard Bluff Drive',16),
  ('Ambush Canyon',17),
  ('Crown King Way',18),
  ('Granite Creek Drive',19),
  ('Granite Hill Drive',20),
  ('Kettering Drive',21),
  ('Long Lasso Pass',22),
  ('Scout Pony Drive',23),
  ('Desert Shade Bend',24)
) as v(name,pos) where t.code='A'
on conflict (territory_id,name) do nothing;

insert into public.territories (code,name,city,zip,hail,storm_date,priority,schedule,description) values ('B','Mason Hills','Leander','78641','3.00–3.25″','2025-05-28',2,'Martes','N Lakeline Blvd al norte de Crystal Falls Pkwy, hasta Mason Creek Blvd') on conflict (code) do nothing;
insert into public.territory_streets (territory_id,name,position)
select t.id, v.name, v.pos from public.territories t, (values
  ('Graford Street',0),
  ('Saddlespur Lane',1),
  ('Sampley Lane',2),
  ('Cotton Farm Trail',3),
  ('Bovina Drive',4),
  ('MacFarland Street',5),
  ('Stinnett Drive',6),
  ('Osprey Drive',7),
  ('Falcon Oaks Drive',8),
  ('Timarron',9),
  ('La Costa',10),
  ('Mira Vista',11),
  ('Beaverton Drive',12),
  ('Tailwater Cove',13),
  ('Hamiltons Way',14),
  ('Mason Creek Boulevard',15),
  ('Columbine Lane',16),
  ('Deepwoods Trail',17),
  ('Overland Drive',18),
  ('Oak Hollow Drive',19),
  ('Parkwood Drive',20),
  ('Nightshade Lane',21),
  ('Eagles Way',22),
  ('Deerpath Street',23)
) as v(name,pos) where t.code='B'
on conflict (territory_id,name) do nothing;

insert into public.territories (code,name,city,zip,hail,storm_date,priority,schedule,description) values ('C','Heritage Park y Cedar Park norte','Cedar Park','78613','3.00–3.25″','2025-05-28',3,'Miércoles','Alrededor de W New Hope Dr, entre N Lakeline Blvd y N Bell Blvd (zona de Cedar Park High School)') on conflict (code) do nothing;
insert into public.territory_streets (territory_id,name,position)
select t.id, v.name, v.pos from public.territories t, (values
  ('Gretchen Drive',0),
  ('Keegan''s Way',1),
  ('Drue Lane',2),
  ('Abbey Lane',3),
  ('Bullhill Cove',4),
  ('Lloydminister Way',5),
  ('Cedar Oaks Drive',6),
  ('Country Squire Drive',7),
  ('Hawksbury Way',8),
  ('Carriage Hills Trail',9),
  ('Wood Creek Drive',10),
  ('Corbin Way',11),
  ('Ariella Drive',12),
  ('Branum Drive',13),
  ('Wheaton Trail',14),
  ('Sedbury Way',15),
  ('Vaughter Lane',16),
  ('Ney Cove',17),
  ('Machado Road',18),
  ('Brashear Lane',19),
  ('Hillery Cove',20),
  ('Hollow Ridge Drive',21),
  ('Lodestone Circle',22),
  ('Silverstone Lane',23),
  ('Sweetwater Lane',24)
) as v(name,pos) where t.code='C'
on conflict (territory_id,name) do nothing;

insert into public.territories (code,name,city,zip,hail,storm_date,priority,schedule,description) values ('D','Cedar Park centro-oeste','Cedar Park','78613','2.75–3.00″','2025-05-28',4,'Jueves (mañana)','Al norte y sur de W Whitestone Blvd, entre Lakeline Blvd y Cedar Park Dr. Aquí hubo 2″ medido en tierra.') on conflict (code) do nothing;
insert into public.territory_streets (territory_id,name,position)
select t.id, v.name, v.pos from public.territories t, (values
  ('Treeline Drive',0),
  ('Terrace View Drive',1),
  ('Rimstone Drive',2),
  ('Marysol Trail',3),
  ('Featherlite Drive',4),
  ('Lone Star Drive',5),
  ('Prize Oaks Drive',6),
  ('Bluebonnet Drive',7),
  ('Cedar Park Drive',8),
  ('Hall Street',9),
  ('Royal Lane',10),
  ('Woodall Drive',11),
  ('Vista Oaks Drive',12)
) as v(name,pos) where t.code='D'
on conflict (territory_id,name) do nothing;

insert into public.territories (code,name,city,zip,hail,storm_date,priority,schedule,description) values ('F','Cedar Park este','Cedar Park','78613','2.50–2.75″','2025-05-28',5,'Jueves (tarde)','Al este de N Bell Blvd, alrededor de E New Hope Dr y Bull Creek Pkwy') on conflict (code) do nothing;
insert into public.territory_streets (territory_id,name,position)
select t.id, v.name, v.pos from public.territories t, (values
  ('Columbine Avenue',0),
  ('Briar Cove',1),
  ('Brazil Drive',2),
  ('Clover Lane',3),
  ('Cypress Lane',4),
  ('Poplar Lane',5),
  ('Sumac Lane',6),
  ('Deerfield Park Drive',7),
  ('Deodara Drive',8),
  ('Glen Field Drive',9),
  ('Valk Street',10),
  ('Cotton Pickin Lane',11),
  ('Big Bend Drive',12),
  ('Davis Mountain Loop',13),
  ('East New Hope Drive',14)
) as v(name,pos) where t.code='F'
on conflict (territory_id,name) do nothing;

insert into public.territories (code,name,city,zip,hail,storm_date,priority,schedule,description) values ('E','County Glen y Leander centro-sur','Leander','78641','2.50–3.00″','2025-05-28',6,'Viernes','Entre S Bagdad Rd y US 183, al sur del centro de Leander. Reporte oficial de 1.75″ cerca.') on conflict (code) do nothing;
insert into public.territory_streets (territory_id,name,position)
select t.id, v.name, v.pos from public.territories t, (values
  ('County Glen Drive',0),
  ('Ireland Drive',1),
  ('Killarney Drive',2),
  ('Newcastle Lane',3),
  ('Shamrock Drive',4),
  ('Hernandos Loop',5),
  ('Limerick Lane',6),
  ('Tejas Trail',7),
  ('Castlewood Trail',8),
  ('Seminole Road',9),
  ('Sioux Trail',10),
  ('Foothills',11),
  ('Stagecoach Cove',12),
  ('Adrian Drive',13),
  ('Old Bagdad Road',14),
  ('Wigwam',15),
  ('Winecup Court',16),
  ('Los Vista Drive',17),
  ('Appalachian Trail',18),
  ('Cotton Patch Trail',19),
  ('Verde Ranch Loop',20)
) as v(name,pos) where t.code='E'
on conflict (territory_id,name) do nothing;

insert into public.territories (code,name,city,zip,hail,storm_date,priority,schedule,description) values ('G','Grand Mesa at Crystal Falls','Leander','78641','2.25–2.75″','2025-05-28',7,'Semana 2','Al oeste de la zona A, por Crystal Falls Pkwy hacia el oeste') on conflict (code) do nothing;
insert into public.territory_streets (territory_id,name,position)
select t.id, v.name, v.pos from public.territories t, (values
  ('Goodnight Trail',0),
  ('High Lonesome',1),
  ('Lajitas',2),
  ('Camelback',3),
  ('Pasa Tiempo',4),
  ('Roaring Fork',5),
  ('Speaking Rock',6),
  ('Squa Valley',7),
  ('Palos Verdes',8),
  ('La Cantera',9),
  ('Ventana Canyon',10),
  ('Coronado Spyglass Hill',11),
  ('Rio Seco',12),
  ('El Cielo',13),
  ('Bachelor Gulch',14),
  ('Painted Sky Bend',15),
  ('War Wagon Way',16),
  ('Wild Indigo Way',17)
) as v(name,pos) where t.code='G'
on conflict (territory_id,name) do nothing;

insert into public.territories (code,name,city,zip,hail,storm_date,priority,schedule,description) values ('H','Vista Ridge, Carneros Ranch y Westview Meadows','Leander','78641','2.50–3.00″','2025-05-28',8,'Semana 2','Al norte de Mason Hills, a ambos lados de N Lakeline Blvd') on conflict (code) do nothing;
insert into public.territory_streets (territory_id,name,position)
select t.id, v.name, v.pos from public.territories t, (values
  ('Paseo Verde Drive',0),
  ('Baranco Way',1),
  ('Encino Drive',2),
  ('Olmos Drive',3),
  ('Nogales Lane',4),
  ('Rancho Verde Drive',5),
  ('Camay Street',6),
  ('Tinto Street',7),
  ('Vouvray Street',8),
  ('Pinot Noir Street',9),
  ('Crooked Creek Street',10),
  ('Wildhorse Street',11),
  ('Cottontail Drive',12),
  ('Thomas Cove',13),
  ('Topaz Lane',14),
  ('West South Street',15),
  ('Lee Drive',16),
  ('Northern Trail',17),
  ('Sherry Drive',18)
) as v(name,pos) where t.code='H'
on conflict (territory_id,name) do nothing;

insert into public.territories (code,name,city,zip,hail,storm_date,priority,schedule,description) values ('I','Thousand Oaks y Forest Oaks','Cedar Park','78613','2.25–2.50″','2025-05-28',9,'Semana 2','Sureste de Cedar Park, entre E Park St, S Bell Blvd y el 183A') on conflict (code) do nothing;
insert into public.territory_streets (territory_id,name,position)
select t.id, v.name, v.pos from public.territories t, (values
  ('East Park Street',0),
  ('Linden Loop',1),
  ('Peyton Place',2),
  ('Shiloh Street',3),
  ('Willowbrook Drive',4),
  ('Glacier Drive',5),
  ('Mesa Verde',6),
  ('North Mount Rushmore Drive',7),
  ('South Mount Rushmore Drive',8),
  ('South Kings Canyon Drive',9),
  ('North Cougar Avenue',10),
  ('Paso Fino Trail',11),
  ('Parkwest Drive',12),
  ('Cardinal Lane',13),
  ('Dogwood Trail',14),
  ('Monarch Cove',15),
  ('Settlement Cove',16)
) as v(name,pos) where t.code='I'
on conflict (territory_id,name) do nothing;

insert into public.territories (code,name,city,zip,hail,storm_date,priority,schedule,description) values ('J','Northcreek, Hawke''s Landing y Greatwood','Leander','78641','2.25–2.50″','2025-05-28',10,'Semana 2 (borde)','Norte de Leander, a lo largo de W Hero Way. Borde de la franja: prioridad más baja.') on conflict (code) do nothing;
insert into public.territory_streets (territory_id,name,position)
select t.id, v.name, v.pos from public.territories t, (values
  ('Landing Lane',0),
  ('Bear Creek Drive',1),
  ('Critty Lane',2),
  ('Sunny Ridge Drive',3),
  ('Waterfall Avenue',4),
  ('Maplecreek Drive',5),
  ('Riverway Lane',6),
  ('Southcreek Drive',7),
  ('Deercreek Lane',8),
  ('Candlelight Drive',9),
  ('Edgewood Cove',10),
  ('Sydnee Drive',11),
  ('Lauren Loop',12),
  ('Apple Springs Drive',13),
  ('Apple Springs Hollow',14),
  ('Harkey Cove',15),
  ('Brown Bluff Circle',16),
  ('Greatwood Trail',17),
  ('Council Springs Pass',18),
  ('Jacksonville Way',19),
  ('Aquilla Drive',20)
) as v(name,pos) where t.code='J'
on conflict (territory_id,name) do nothing;
