import { useEffect, useRef } from 'react';
import { useLogStore, type LogEntry, type LogLevel } from './logStore';
import './LogPanel.css';

/**
 * features/log/LogPanel.tsx
 * Console riwayat aktivitas client-side — command yang dikirim lewat
 * DeviceClient dari fitur mana pun, hasilnya, frame unsolicited, error
 * parsing protokol, dan perubahan status koneksi. Lihat logStore.ts untuk
 * dari mana entry-nya datang; panel ini murni tampilan + auto-scroll.
 */

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: 'info',
  success: 'ok',
  error: 'error',
  warning: 'warn',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <div className="log-row" data-level={entry.level}>
      <span className="log-time">{formatTime(entry.timestamp)}</span>
      <span className="log-level-badge" data-level={entry.level}>
        {LEVEL_LABEL[entry.level]}
      </span>
      <span className="log-message">
        {entry.message}
        {entry.detail && <span className="log-detail"> — {entry.detail}</span>}
      </span>
    </div>
  );
}

function LogPanel() {
  const entries = useLogStore((s) => s.entries);
  const clear = useLogStore((s) => s.clear);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  // Auto-scroll ke entry terbaru, TAPI hanya kalau user memang sedang di
  // bawah sebelum entry baru masuk — supaya scroll-up untuk baca log lama
  // tidak dipaksa balik ke bawah tiap ada command baru lewat.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  };

  return (
    <div className="log-panel">
      <div className="log-intro">
        <h2>Log Aktivitas</h2>
        <p>
          Riwayat command yang dikirim ke device dari semua tab, balasannya, dan event koneksi. Hanya
          tersimpan di browser selama sesi ini — tidak dikirim/diminta ke firmware.
        </p>
      </div>

      <div className="log-toolbar">
        <span className="log-count">{entries.length} entri</span>
        <button type="button" className="log-clear-button" onClick={clear} disabled={entries.length === 0}>
          Bersihkan
        </button>
      </div>

      <div className="log-list" ref={listRef} onScroll={handleScroll}>
        {entries.length === 0 ? (
          <div className="log-empty">Belum ada aktivitas. Command dari tab lain akan muncul di sini.</div>
        ) : (
          entries.map((entry) => <LogRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}

export default LogPanel;
