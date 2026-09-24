import { toLatLonFloat } from '../../shared/utils/geo';
import type { HomeSendPhase } from './useMissionUpload';
import { useMissionStore } from './missionStore';
import './HomePanel.css';

interface HomePanelProps {
  sendPhase: HomeSendPhase;
  sendError: string | null;
  onSend: () => void;
}

function HomePanel({ sendPhase, sendError, onSend }: HomePanelProps) {
  const home = useMissionStore((s) => s.home);
  const setHome = useMissionStore((s) => s.setHome);
  const clearHome = useMissionStore((s) => s.clearHome);

  if (!home) {
    return (
      <div className="home-panel home-panel-empty">
        Belum ada Home. Pilih mode "set Home" di atas lalu klik peta, atau isi manual di sini.
        <button
          type="button"
          className="btn btn-secondary btn-sm home-set-manual-button"
          onClick={() => setHome(-6.1783, 106.6319, 0)}
        >
          Isi manual
        </button>
      </div>
    );
  }

  const { lat, lon } = toLatLonFloat(home.latE7, home.lonE7);

  return (
    <div className="home-panel">
      <div className="home-panel-fields">
        <label>
          Lat
          <input
            type="number"
            className="mono"
            value={lat}
            step="0.000001"
            onChange={(e) => setHome(Number(e.target.value), lon, home.altitudeM)}
          />
        </label>
        <label>
          Lon
          <input
            type="number"
            className="mono"
            value={lon}
            step="0.000001"
            onChange={(e) => setHome(lat, Number(e.target.value), home.altitudeM)}
          />
        </label>
        <label>
          Alt (m)
          <input
            type="number"
            className="mono"
            value={home.altitudeM}
            step="1"
            onChange={(e) => setHome(lat, lon, Number(e.target.value))}
          />
        </label>
      </div>
      <div className="home-panel-actions">
        <button
          type="button"
          className="btn btn-primary home-send-button"
          onClick={onSend}
          disabled={sendPhase === 'sending'}
        >
          {sendPhase === 'sending' ? 'Mengirim…' : 'Kirim Home ke Device'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm home-clear-button" onClick={clearHome}>
          Hapus
        </button>
        {sendPhase === 'done' && <span className="mission-status-ok">Terkirim.</span>}
        {sendPhase === 'error' && <span className="mission-status-error">{sendError ?? 'Gagal'}</span>}
      </div>
    </div>
  );
}

export default HomePanel;
