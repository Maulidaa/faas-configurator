import type { WaypointAction } from '../../shared/types';
import { toLatLonFloat } from '../../shared/utils/geo';
import { useMissionStore } from './missionStore';
import './WaypointTable.css';

const ACTION_LABELS: Record<WaypointAction['type'], string> = {
  waypoint: 'Waypoint',
  loiter: 'Loiter',
  rth: 'RTH',
};

function WaypointTable() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const updateWaypointPosition = useMissionStore((s) => s.updateWaypointPosition);
  const updateWaypointAltitude = useMissionStore((s) => s.updateWaypointAltitude);
  const updateWaypointAction = useMissionStore((s) => s.updateWaypointAction);
  const removeWaypoint = useMissionStore((s) => s.removeWaypoint);
  const moveWaypoint = useMissionStore((s) => s.moveWaypoint);

  if (waypoints.length === 0) {
    return (
      <p className="waypoint-table-empty">
        Belum ada waypoint. Klik peta di atas (mode "tambah waypoint") untuk mulai menambahkan.
      </p>
    );
  }

  return (
    <table className="waypoint-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Lat</th>
          <th>Lon</th>
          <th>Alt (m)</th>
          <th>Aksi</th>
          <th aria-label="Kontrol urutan / hapus"></th>
        </tr>
      </thead>
      <tbody>
        {waypoints.map((wp, index) => {
          const { lat, lon } = toLatLonFloat(wp.latE7, wp.lonE7);
          const actionType = wp.action?.type ?? 'waypoint';
          return (
            <tr key={wp.id}>
              <td className="mono">{wp.seq}</td>
              <td>
                <input
                  type="number"
                  className="mono waypoint-coord-input"
                  value={lat}
                  step="0.000001"
                  onChange={(e) => updateWaypointPosition(wp.id, Number(e.target.value), lon)}
                />
              </td>
              <td>
                <input
                  type="number"
                  className="mono waypoint-coord-input"
                  value={lon}
                  step="0.000001"
                  onChange={(e) => updateWaypointPosition(wp.id, lat, Number(e.target.value))}
                />
              </td>
              <td>
                <input
                  type="number"
                  className="mono waypoint-alt-input"
                  value={wp.altitudeM}
                  step="1"
                  onChange={(e) => updateWaypointAltitude(wp.id, Number(e.target.value))}
                />
              </td>
              <td>
                <div className="waypoint-action-cell">
                  <select
                    value={actionType}
                    onChange={(e) => {
                      const type = e.target.value as WaypointAction['type'];
                      updateWaypointAction(
                        wp.id,
                        type === 'loiter' ? { type: 'loiter', radiusM: 20 } : { type },
                      );
                    }}
                  >
                    {(Object.keys(ACTION_LABELS) as WaypointAction['type'][]).map((type) => (
                      <option key={type} value={type}>
                        {ACTION_LABELS[type]}
                      </option>
                    ))}
                  </select>
                  {wp.action?.type === 'loiter' && (
                    <input
                      type="number"
                      className="mono waypoint-radius-input"
                      title="Radius loiter (meter)"
                      value={wp.action.radiusM}
                      step="1"
                      min="1"
                      onChange={(e) =>
                        updateWaypointAction(wp.id, { type: 'loiter', radiusM: Number(e.target.value) })
                      }
                    />
                  )}
                </div>
              </td>
              <td className="waypoint-row-controls">
                <button
                  type="button"
                  className="waypoint-icon-button"
                  title="Naikkan urutan"
                  disabled={index === 0}
                  onClick={() => moveWaypoint(wp.id, 'up')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="waypoint-icon-button"
                  title="Turunkan urutan"
                  disabled={index === waypoints.length - 1}
                  onClick={() => moveWaypoint(wp.id, 'down')}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="waypoint-icon-button waypoint-icon-button-danger"
                  title="Hapus waypoint"
                  onClick={() => removeWaypoint(wp.id)}
                >
                  ✕
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default WaypointTable;
