import L from 'leaflet';
import type { WaypointAction } from '../../shared/types';

/**
 * features/mission/missionIcons.ts
 * DivIcon murni CSS (bukan file gambar) supaya konsisten dengan tema aurora
 * index.css dan tidak menambah aset biner ke bundle. Warna dibedakan per
 * jenis aksi waypoint: hijau (waypoint biasa), violet (loiter), merah (RTH)
 * — merah dipakai karena RTH biasanya jadi penanda "kondisi darurat/pulang".
 */

const ACTION_COLOR: Record<WaypointAction['type'], string> = {
  waypoint: '#37d6a8',
  loiter: '#8b7fe8',
  rth: '#f2624b',
};

export function waypointIcon(seq: number, actionType: WaypointAction['type']): L.DivIcon {
  const color = ACTION_COLOR[actionType];
  return L.divIcon({
    className: 'mission-marker',
    html: `<div class="mission-marker-dot" style="background:${color}">${seq}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export function homeIcon(): L.DivIcon {
  return L.divIcon({
    className: 'mission-marker',
    html: `<div class="mission-marker-home">⌂</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}
