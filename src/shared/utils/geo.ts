/**
 * shared/utils/geo.ts
 * Konversi lat/lon float <-> fixed-point int32 (skala 1e7) — HANYA boleh
 * terjadi di sini (web-configurator-architecture.md Bagian 4.5 & 13). UI peta
 * selalu bekerja dengan float; serialisasi ke command selalu lewat fungsi ini.
 */

const SCALE = 1e7;

export function toLatLonFloat(latE7: number, lonE7: number): { lat: number; lon: number } {
  return { lat: latE7 / SCALE, lon: lonE7 / SCALE };
}

export function fromLatLonFloat(lat: number, lon: number): { latE7: number; lonE7: number } {
  return { latE7: Math.round(lat * SCALE), lonE7: Math.round(lon * SCALE) };
}
