import { create } from 'zustand';
import type { HomePosition, Waypoint, WaypointAction } from '../../shared/types';
import { fromLatLonFloat } from '../../shared/utils/geo';

/**
 * features/mission/missionStore.ts
 * Draft misi (waypoint list + home) HANYA hidup di browser sampai user
 * sengaja menekan "Upload ke Device" / "Kirim Home ke Device" — device tidak
 * pernah jadi sumber kebenaran untuk draft yang belum dikirim (tidak ada
 * command untuk membaca balik mission dari device di protocol.md v1).
 *
 * Sengaja Zustand store sendiri (bukan React state lokal di MissionPanel)
 * supaya draft tidak hilang kalau user pindah tab lalu balik lagi, atau
 * device sempat terputus di tengah proses — DeviceClient.handleDisconnect
 * eksplisit bilang ini tanggung jawab store fitur masing-masing, bukan dia.
 */

interface MissionDraftState {
  waypoints: Waypoint[];
  home: HomePosition | null;
  addWaypoint: (lat: number, lon: number, altitudeM?: number) => void;
  updateWaypointPosition: (id: string, lat: number, lon: number) => void;
  updateWaypointAltitude: (id: string, altitudeM: number) => void;
  updateWaypointAction: (id: string, action: WaypointAction) => void;
  removeWaypoint: (id: string) => void;
  moveWaypoint: (id: string, direction: 'up' | 'down') => void;
  setHome: (lat: number, lon: number, altitudeM?: number) => void;
  clearHome: () => void;
  clearAll: () => void;
}

function renumber(waypoints: Waypoint[]): Waypoint[] {
  return waypoints.map((wp, i) => ({ ...wp, seq: i }));
}

export const useMissionStore = create<MissionDraftState>((set) => ({
  waypoints: [],
  home: null,

  addWaypoint(lat, lon, altitudeM = 50) {
    const { latE7, lonE7 } = fromLatLonFloat(lat, lon);
    set((s) => ({
      waypoints: renumber([
        ...s.waypoints,
        { id: crypto.randomUUID(), seq: 0, latE7, lonE7, altitudeM, action: { type: 'waypoint' } },
      ]),
    }));
  },

  updateWaypointPosition(id, lat, lon) {
    const { latE7, lonE7 } = fromLatLonFloat(lat, lon);
    set((s) => ({
      waypoints: s.waypoints.map((wp) => (wp.id === id ? { ...wp, latE7, lonE7 } : wp)),
    }));
  },

  updateWaypointAltitude(id, altitudeM) {
    set((s) => ({
      waypoints: s.waypoints.map((wp) => (wp.id === id ? { ...wp, altitudeM } : wp)),
    }));
  },

  updateWaypointAction(id, action) {
    set((s) => ({
      waypoints: s.waypoints.map((wp) => (wp.id === id ? { ...wp, action } : wp)),
    }));
  },

  removeWaypoint(id) {
    set((s) => ({ waypoints: renumber(s.waypoints.filter((wp) => wp.id !== id)) }));
  },

  moveWaypoint(id, direction) {
    set((s) => {
      const idx = s.waypoints.findIndex((wp) => wp.id === id);
      if (idx === -1) return s;
      const swapWith = direction === 'up' ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= s.waypoints.length) return s;
      const next = [...s.waypoints];
      const tmp = next[idx];
      next[idx] = next[swapWith];
      next[swapWith] = tmp;
      return { waypoints: renumber(next) };
    });
  },

  setHome(lat, lon, altitudeM = 0) {
    const { latE7, lonE7 } = fromLatLonFloat(lat, lon);
    set({ home: { latE7, lonE7, altitudeM } });
  },

  clearHome() {
    set({ home: null });
  },

  clearAll() {
    set({ waypoints: [], home: null });
  },
}));
