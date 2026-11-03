// Regiones de trabajo. bbox = [sur, oeste, norte, este]
export type Region = { key: "austin" | "san_antonio"; name: string; bbox: [number, number, number, number] };
export const REGIONS: Region[] = [
  { key: "austin", name: "Austin", bbox: [29.86, -98.25, 31.0, -97.2] },
  { key: "san_antonio", name: "San Antonio", bbox: [29.22, -98.85, 29.86, -97.95] },
];
export const regionOfBbox = (b: number[] | null | undefined): Region["key"] | null => {
  if (!b) return null;
  const lat = (b[0] + b[2]) / 2;
  return lat < 29.86 ? "san_antonio" : "austin";
};
