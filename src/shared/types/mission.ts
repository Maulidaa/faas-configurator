/**
 * Mission planning types. Frozen per web-configurator-architecture.md Bagian 4.5.
 * latE7/lonE7 are fixed-point int32 (scale 1e7) — identical representation to
 * firmware. UI always works in float; conversion only happens in
 * shared/utils/geo.ts (toLatLonFloat / fromLatLonFloat).
 */

export type WaypointAction =
  | { type: 'waypoint' }
  | { type: 'rth' }
  | { type: 'loiter'; radiusM: number };

export interface Waypoint {
  id: string;
  seq: number;
  latE7: number;
  lonE7: number;
  altitudeM: number;
  action?: WaypointAction;
}

export interface HomePosition {
  latE7: number;
  lonE7: number;
  altitudeM: number;
}

/**
 * NAV_Mode_t di firmware (navigation.h) — urutan numerik EKSPLISIT karena
 * dikirim mentah sebagai u8 di response CMD_RTH_TRIGGER (missionCommands.ts).
 * Jangan ubah urutan array NAV_MODES di missionCommands.ts tanpa cek ulang
 * enum firmware.
 */
export type NavMode = 'idle' | 'altitude-hold' | 'waypoint' | 'rth' | 'rth-no-gps-fallback';

export interface RthTriggerResult {
  ok: boolean;
  /** Mode nav SETELAH trigger — 'rth' kalau GPS fix tersedia saat dipicu, 'rth-no-gps-fallback' kalau tidak. */
  navMode: NavMode;
}
