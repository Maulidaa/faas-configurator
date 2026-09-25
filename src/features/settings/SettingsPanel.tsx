import { useConnectionStore } from '../../store/connectionStore';
import SchemaField from './SchemaField';
import { useSettingsSchema } from './useSettingsSchema';
import { useSettingValues } from './useSettingValues';
import './SettingsPanel.css';

/**
 * features/settings/SettingsPanel.tsx
 * Baca & tulis setting device lewat schema generik (CMD_SETTING_SCHEMA_LIST/
 * GET/SET/COMMIT). Tidak ada UI khusus per-field yang di-hardcode di sini —
 * seluruh tree (termasuk grup baru yang ditambah firmware nanti) otomatis
 * muncul lewat SchemaField rekursif.
 */
function SettingsPanel() {
  const client = useConnectionStore((s) => s.contentClient);
  const connectionState = useConnectionStore((s) => s.connectionState);
  const armed = useConnectionStore((s) => s.deviceStatus?.armed ?? false);
  const ready = connectionState === 'connected';

  const { fields, loading: schemaLoading, error: schemaError, reload } = useSettingsSchema(client, ready);
  const { values, statuses, fieldErrors, setValue, committing, commitResult, commit } = useSettingValues(
    client,
    fields,
  );

  if (schemaError) {
    return (
      <div className="settings-panel settings-panel-message">
        <p>Gagal memuat skema pengaturan dari device.</p>
        <p className="settings-panel-message-detail mono">{schemaError}</p>
        <button type="button" className="btn btn-secondary settings-retry-button" onClick={reload}>
          Coba lagi
        </button>
      </div>
    );
  }

  if (schemaLoading && fields.length === 0) {
    return <div className="settings-panel settings-panel-message">Memuat skema pengaturan dari device…</div>;
  }

  if (fields.length === 0) {
    return <div className="settings-panel settings-panel-message">Device belum melaporkan setting apa pun.</div>;
  }

  return (
    <div className="settings-panel">
      {armed && (
        <div className="settings-armed-banner">
          Device sedang <strong>ARMED</strong> — pengaturan bertanda 🔒 dikunci sampai disarmed.
        </div>
      )}

      <div className="settings-tree">
        {fields.map((field) => (
          <SchemaField
            key={field.key}
            field={field}
            values={values}
            statuses={statuses}
            fieldErrors={fieldErrors}
            armed={armed}
            onChange={setValue}
          />
        ))}
      </div>

      <div className="settings-commit-bar">
        <button type="button" className="btn btn-primary settings-commit-button" onClick={commit} disabled={committing}>
          {committing ? 'Menyimpan ke flash…' : 'Commit ke Flash'}
        </button>
        <span className="settings-commit-hint">
          Perubahan di atas langsung berlaku di RAM device — tekan ini untuk menyimpannya permanen.
        </span>
        {commitResult === 'ok' && <span className="schema-status-ok">Tersimpan permanen.</span>}
        {commitResult === 'rejected' && <span className="schema-status-warn">Ditolak device.</span>}
        {commitResult === 'error' && <span className="schema-status-error">Gagal commit.</span>}
      </div>
    </div>
  );
}

export default SettingsPanel;
