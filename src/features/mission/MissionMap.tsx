import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { LeafletMouseEvent } from 'leaflet';
import { toLatLonFloat } from '../../shared/utils/geo';
import { homeIcon, waypointIcon } from './missionIcons';
import { useMissionStore } from './missionStore';
import 'leaflet/dist/leaflet.css';
import './MissionMap.css';

/** Tangerang, Banten — dipakai sebagai center default kalau belum ada home/waypoint sama sekali. */
const DEFAULT_CENTER: [number, number] = [-6.1783, 106.6319];
const DEFAULT_ZOOM = 14;

type MapMode = 'add-waypoint' | 'set-home';

function ClickHandler({ mode }: { mode: MapMode }) {
  const addWaypoint = useMissionStore((s) => s.addWaypoint);
  const setHome = useMissionStore((s) => s.setHome);

  useMapEvents({
    click(e: LeafletMouseEvent) {
      if (mode === 'set-home') {
        setHome(e.latlng.lat, e.latlng.lng);
      } else {
        addWaypoint(e.latlng.lat, e.latlng.lng);
      }
    },
  });

  return null;
}

/** Sekali pindahkan viewport ke home/waypoint pertama begitu draft yang sebelumnya kosong mulai terisi. */
function AutoCenterOnce() {
  const map = useMap();
  const home = useMissionStore((s) => s.home);
  const waypoints = useMissionStore((s) => s.waypoints);
  const hasCenteredRef = useRef(false);

  useEffect(() => {
    if (hasCenteredRef.current) return;
    const anchor = home ?? waypoints[0];
    if (!anchor) return;
    const { lat, lon } = toLatLonFloat(anchor.latE7, anchor.lonE7);
    map.setView([lat, lon], map.getZoom());
    hasCenteredRef.current = true;
  }, [home, waypoints, map]);

  return null;
}

function MissionMap() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const home = useMissionStore((s) => s.home);
  const updateWaypointPosition = useMissionStore((s) => s.updateWaypointPosition);
  const setHome = useMissionStore((s) => s.setHome);
  const [mode, setMode] = useState<MapMode>('add-waypoint');

  return (
    <div className="mission-map-wrap">
      <div className="mission-map-toolbar">
        <button
          type="button"
          className={`btn btn-sm mission-mode-button ${mode === 'add-waypoint' ? 'active' : ''}`}
          onClick={() => setMode('add-waypoint')}
        >
          Klik peta: tambah waypoint
        </button>
        <button
          type="button"
          className={`btn btn-sm mission-mode-button ${mode === 'set-home' ? 'active' : ''}`}
          onClick={() => setMode('set-home')}
        >
          Klik peta: set Home
        </button>
      </div>

      <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} className="mission-map">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        <ClickHandler mode={mode} />
        <AutoCenterOnce />

        {home && (
          <Marker
            position={toLatLonFloatTuple(home.latE7, home.lonE7)}
            icon={homeIcon()}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const pos = e.target.getLatLng();
                setHome(pos.lat, pos.lng, home.altitudeM);
              },
            }}
          />
        )}

        {waypoints.map((wp) => (
          <Marker
            key={wp.id}
            position={toLatLonFloatTuple(wp.latE7, wp.lonE7)}
            icon={waypointIcon(wp.seq, wp.action?.type ?? 'waypoint')}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const pos = e.target.getLatLng();
                updateWaypointPosition(wp.id, pos.lat, pos.lng);
              },
            }}
          />
        ))}
      </MapContainer>

      <p className="mission-map-note">
        Peta butuh koneksi internet untuk memuat tile (OpenStreetMap) — kalau lagi offline di
        lapangan, ubin peta tidak akan tampil, tapi koordinat waypoint tetap bisa diisi manual
        lewat tabel di bawah.
      </p>
    </div>
  );
}

function toLatLonFloatTuple(latE7: number, lonE7: number): [number, number] {
  const { lat, lon } = toLatLonFloat(latE7, lonE7);
  return [lat, lon];
}

export default MissionMap;
