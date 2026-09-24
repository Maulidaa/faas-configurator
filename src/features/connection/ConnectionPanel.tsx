import { useState } from 'react';
import { WebSerialTransport } from '../../core/transport';
import { DfuDevice } from '../../core/dfu';
import { useConnectionStore } from '../../store/connectionStore';
import './ConnectionPanel.css';

/**
 * features/connection/ConnectionPanel.tsx
 * Ditampilkan menggantikan tab strip selagi belum ada device terhubung
 * (App.tsx: status koneksi ada di header, tapi ALUR konek butuh layar
 * sendiri — device picker WebUSB/WebSerial wajib dipicu dari user gesture,
 * jadi tidak bisa otomatis di background).
 */
function IconUsb() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M12 3v10m0 0-3-3m3 3 3-3M6 13h12v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-1.5-5.2V8.2l5.2 3.8-5.2 3.8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChip() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M9 4v2.2M12 4v2.2M15 4v2.2M9 17.8V20M12 17.8V20M15 17.8V20M4 9h2.2M4 12h2.2M4 15h2.2M17.8 9H20M17.8 12H20M17.8 15H20"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="M12 4 2.5 20h19L12 4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 10v4.5M12 17.5v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

interface ConnectionPanelProps {
  /** Disuntikkan App.tsx supaya features/connection tidak import features/dfu (arsitektur Bagian 3). */
  onStartStandaloneDfu?: () => void;
}

type ConnectionPage = 'menu' | 'demo' | 'dfu';

function ConnectionPanel({ onStartStandaloneDfu }: ConnectionPanelProps) {
  const connectionState = useConnectionStore((s) => s.connectionState);
  const lastError = useConnectionStore((s) => s.lastError);
  const connectDemo = useConnectionStore((s) => s.connectDemo);
  const connectSerial = useConnectionStore((s) => s.connectSerial);
  const [pendingAction, setPendingAction] = useState<'serial' | 'demo' | null>(null);

  const serialSupported = WebSerialTransport.isSupported();
  const webusbSupported = DfuDevice.isSupported();
  const [page, setPage] = useState<ConnectionPage>('menu');
  const connecting = connectionState === 'connecting';
  // pendingAction dicek langsung di sini (bukan cuma `connecting` dari store)
  // supaya tombol ke-disable SEGERA begitu diklik — `connectionState` baru
  // pindah ke 'connecting' setelah requestDevice() (dialog pilih port)
  // selesai, jadi ada jeda di mana user masih bisa klik dua kali dan memicu
  // requestPort() ganda (error "a request is already in progress").
  const busy = connecting || pendingAction !== null;

  const handleConnectSerial = async () => {
    if (busy) return;
    setPendingAction('serial');
    try {
      await connectSerial();
    } finally {
      setPendingAction(null);
    }
  };

  const handleConnectDemo = async () => {
    if (busy) return;
    setPendingAction('demo');
    try {
      await connectDemo();
    } finally {
      setPendingAction(null);
    }
  };

  const handleStartStandaloneDfu = () => {
    if (busy) return;
    // Sinkron, bukan async — cuma set state di dfuStore (mirip
    // rebootToDfu tapi tanpa langkah kirim CMD_REBOOT_DFU lewat serial).
    // Picker WebUSB sendiri baru dipanggil user lewat tombol "Pilih Device
    // DFU" di dalam DfuPanel, supaya tetap lewat user-gesture langsung.
    onStartStandaloneDfu?.();
  };

  return (
    <div className="connection-panel">
      <div className="connection-card">
        <div className="connection-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
            <path
              d="M4 17V7a1 1 0 0 1 1-1h6l2 2h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2>{page === 'menu' ? 'Hubungkan FC' : page === 'demo' ? 'Mode Demo' : 'DFU / Bootloader'}</h2>
        <p className="connection-lead">
          {page === 'menu'
            ? 'Hubungkan USB native Black Pill, atau coba tanpa hardware.'
            : page === 'demo'
              ? 'Coba FAAS tanpa hardware.'
              : 'Flash firmware melalui device bootloader.'}
        </p>

        {page === 'menu' ? (
          <div className="connection-menu">
            <button
              type="button"
              className="connection-button connection-button-primary"
              onClick={handleConnectSerial}
              disabled={!serialSupported || busy}
            >
              <IconUsb />
              <span>{pendingAction === 'serial' ? 'Menyambung…' : 'Hubungkan via USB'}</span>
              {pendingAction === 'serial' && <span className="connection-spinner" />}
            </button>
            <p className="connection-note connection-note-inline">
              Gunakan USB native Black Pill dengan firmware USB CDC. ST-Link hanya untuk flash/debug.
            </p>
            <button type="button" className="connection-button connection-button-secondary" onClick={() => setPage('demo')}>
              <IconPlay />
              <span>Mode Demo</span>
            </button>
            <button type="button" className="connection-button connection-button-secondary" onClick={() => setPage('dfu')}>
              <IconChip />
              <span>DFU / Bootloader</span>
            </button>
          </div>
        ) : (
          <div className="connection-page">
            <button type="button" className="connection-back" onClick={() => setPage('menu')} disabled={busy}>
              ← Kembali
            </button>

            {page === 'demo' && (
              <>
                <button type="button" className="connection-button connection-button-secondary" onClick={handleConnectDemo} disabled={busy}>
                  <IconPlay />
                  <span>{pendingAction === 'demo' ? 'Menyiapkan…' : 'Mulai Demo'}</span>
                  {pendingAction === 'demo' && <span className="connection-spinner" />}
                </button>
                <p className="connection-note">Simulasikan device di browser untuk mencoba Settings, Mission, dan DFU.</p>
              </>
            )}

            {page === 'dfu' && (
              <>
                <button type="button" className="connection-button connection-button-secondary" onClick={handleStartStandaloneDfu} disabled={!webusbSupported || busy}>
                  <IconChip />
                  <span>Pilih Device DFU</span>
                </button>
                <p className="connection-note">
                  Gunakan jika device tampil sebagai <span className="mono">STM32 BOOTLOADER</span> di Device Manager.
                </p>
                {!webusbSupported && (
                  <p className="connection-note connection-note-warning">
                    <IconWarning />
                    WebUSB tidak didukung browser ini.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {lastError && (
          <p className="connection-note connection-note-error" role="alert">
            {lastError}
          </p>
        )}
      </div>
    </div>
  );
}

export default ConnectionPanel;
