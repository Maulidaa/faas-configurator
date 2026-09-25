import { useConnectionStore } from '../../store/connectionStore';
import HomePanel from './HomePanel';
import MissionMap from './MissionMap';
import WaypointTable from './WaypointTable';
import { useHomeSend, useMissionUpload, useRthTrigger } from './useMissionUpload';
import { useMissionStore } from './missionStore';
import './MissionPanel.css';

/**
 * features/mission/MissionPanel.tsx
 * Rencanakan waypoint di peta (offline-first di sisi UI — draft hidup di
 * missionStore, bukan di device), lalu upload lewat sendChunkedMission.
 * CMD_HOME_SET terpisah dari upload waypoint (bukan bagian dari chunk mission
 * — protocol.md Bagian 5 & 10), jadi tombol kirimnya juga terpisah.
 */
function MissionPanel() {
  const client = useConnectionStore((s) => s.contentClient);
  const armed = useConnectionStore((s) => s.deviceStatus?.armed ?? false);
  const waypoints = useMissionStore((s) => s.waypoints);
  const home = useMissionStore((s) => s.home);
  const clearAll = useMissionStore((s) => s.clearAll);

  const { phase: uploadPhase, progress, error: uploadError, upload } = useMissionUpload(client);
  const { phase: homePhase, error: homeError, send: sendHome } = useHomeSend(client);
  const { phase: rthPhase, navMode: rthNavMode, error: rthError, trigger: triggerRth } = useRthTrigger(client);

  const handleTriggerRth = () => {
    const confirmed = window.confirm(
      'Trigger RTH manual sekarang? Pesawat akan langsung masuk mode Return-To-Home (atau fallback tanpa GPS kalau fix tidak tersedia).',
    );
    if (confirmed) triggerRth();
  };

  return (
    <div className="mission-panel">
      {armed && (
        <div className="mission-armed-banner">
          Device sedang <strong>ARMED</strong>. protocol.md tidak menggating CMD_MISSION_UPLOAD/
          CMD_HOME_SET saat armed — pastikan ini memang aman dilakukan sebelum lanjut.
        </div>
      )}

      <MissionMap />

      <div className="mission-section mission-rth-section">
        <div className="mission-section-header">
          <h3>RTH Manual</h3>
        </div>
        <div className="mission-rth-actions">
          <button
            type="button"
            className="btn btn-danger mission-rth-button"
            onClick={handleTriggerRth}
            disabled={rthPhase === 'sending'}
          >
            {rthPhase === 'sending' ? 'Mengirim…' : 'Trigger RTH Sekarang'}
          </button>
          {rthPhase === 'done' && (
            <span className="mission-status-ok">
              RTH dipicu — mode: <code>{rthNavMode}</code>
            </span>
          )}
          {rthPhase === 'error' && <span className="mission-status-error">{rthError ?? 'Gagal trigger RTH.'}</span>}
        </div>
        <p className="mission-rth-note">
          CMD_RTH_TRIGGER tidak armed-gated (protocol.md Bagian 5 &amp; 10) — bisa dipicu kapan pun, termasuk saat
          armed/terbang. Dipakai sebagai perintah darurat manual dari web, terpisah dari failsafe link-loss otomatis
          di firmware.
        </p>
      </div>

      <div className="mission-section">
        <div className="mission-section-header">
          <h3>Home</h3>
        </div>
        <HomePanel sendPhase={homePhase} sendError={homeError} onSend={() => home && sendHome(home)} />
      </div>

      <div className="mission-section mission-waypoint-section">
        <div className="mission-section-header">
          <h3>Waypoint ({waypoints.length})</h3>
          {waypoints.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm mission-clear-button" onClick={clearAll}>
              Hapus Semua
            </button>
          )}
        </div>
        <div className="waypoint-table-wrap">
          <WaypointTable />
        </div>
      </div>

      <div className="mission-upload-bar">
        <button
          type="button"
          className="btn btn-primary mission-upload-button"
          onClick={() => upload(waypoints)}
          disabled={waypoints.length === 0 || uploadPhase === 'uploading'}
        >
          {uploadPhase === 'uploading' ? 'Mengunggah…' : 'Upload ke Device'}
        </button>
        {uploadPhase === 'uploading' && progress && (
          <span className="mission-upload-progress">
            chunk {progress.sent}/{progress.total}
          </span>
        )}
        {uploadPhase === 'done' && <span className="mission-status-ok">Misi terkirim.</span>}
        {uploadPhase === 'error' && <span className="mission-status-error">{uploadError ?? 'Gagal upload.'}</span>}
      </div>
    </div>
  );
}

export default MissionPanel;
