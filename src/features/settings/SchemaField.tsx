import type { SettingFieldSchema, SettingValue } from '../../shared/types';
import type { FieldSaveStatus } from './useSettingValues';
import './SchemaField.css';

interface SchemaFieldProps {
  field: SettingFieldSchema;
  values: Record<string, SettingValue>;
  statuses: Record<string, FieldSaveStatus>;
  fieldErrors: Record<string, string>;
  armed: boolean;
  onChange: (field: SettingFieldSchema, value: SettingValue) => void;
}

interface ControlProps {
  field: SettingFieldSchema;
  value: SettingValue | undefined;
  disabled: boolean;
  onChange: (value: SettingValue) => void;
}

function SchemaFieldControl({ field, value, disabled, onChange }: ControlProps) {
  switch (field.type) {
    case 'bool':
      return (
        <input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      );

    case 'enum':
      return (
        <select
          value={value !== undefined ? String(value) : ''}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {value === undefined && <option value="" disabled></option>}
          {field.enumOptions?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case 'bitmask': {
      const current = typeof value === 'number' ? value : 0;
      return (
        <div className="schema-bitmask">
          {field.bitmaskFlags?.map((flag) => {
            const checked = (current & flag.bit) === flag.bit;
            return (
              <label key={flag.bit} className="schema-bitmask-flag">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => onChange(e.target.checked ? current | flag.bit : current & ~flag.bit)}
                />
                {flag.label}
              </label>
            );
          })}
        </div>
      );
    }

    case 'string':
      return (
        <input
          type="text"
          className="mono"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'number':
    default: {
      const numValue = typeof value === 'number' ? value : (field.min ?? 0);
      const hasRange = field.min !== undefined && field.max !== undefined;
      return (
        <div className="schema-number">
          {hasRange && (
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              value={numValue}
              disabled={disabled}
              onChange={(e) => onChange(Number(e.target.value))}
            />
          )}
          <input
            type="number"
            className="mono schema-number-input"
            min={field.min}
            max={field.max}
            step={field.step ?? 'any'}
            value={numValue}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
      );
    }
  }
}

/**
 * features/settings/SchemaField.tsx
 * Render rekursif satu SettingFieldSchema. Grup jadi <details> yang bisa
 * dilipat (mixer/output_mapping dkk. bisa banyak field — protocol.md Bagian
 * 7-9); leaf field renders sesuai `type` lewat SchemaFieldControl. Armed-lock
 * (readonlyWhenArmed) dicek di sini, bukan cuma di firmware — supaya user
 * langsung lihat kenapa kontrol ter-disable tanpa perlu coba dulu.
 */
function SchemaField({ field, values, statuses, fieldErrors, armed, onChange }: SchemaFieldProps) {
  const locked = armed && Boolean(field.readonlyWhenArmed);

  if (field.type === 'group') {
    return (
      <details className="schema-group" open>
        <summary>
          <span>{field.label}</span>
          {locked && (
            <span className="schema-lock" title="Grup ini terkunci selagi device armed">
              🔒
            </span>
          )}
        </summary>
        <div className="schema-group-body">
          {field.children?.map((child) => (
            <SchemaField
              key={child.key}
              field={child}
              values={values}
              statuses={statuses}
              fieldErrors={fieldErrors}
              armed={armed}
              onChange={onChange}
            />
          ))}
        </div>
      </details>
    );
  }

  const value = values[field.key];
  const status = statuses[field.key] ?? 'idle';
  const error = fieldErrors[field.key];

  return (
    <div className="schema-field" data-status={status}>
      <div className="schema-field-label">
        <span>{field.label}</span>
        {field.unit && <span className="schema-field-unit">{field.unit}</span>}
        {locked && (
          <span className="schema-lock" title="Terkunci selagi device armed">
            🔒
          </span>
        )}
      </div>
      <div className="schema-field-control">
        <SchemaFieldControl field={field} value={value} disabled={locked} onChange={(v) => onChange(field, v)} />
      </div>
      <div className="schema-field-status">
        {status === 'loading' && <span className="schema-status-muted">memuat…</span>}
        {status === 'saving' && <span className="schema-status-muted">menyimpan…</span>}
        {status === 'saved' && <span className="schema-status-ok">tersimpan</span>}
        {status === 'rejected' && (
          <span className="schema-status-warn">ditolak device{locked ? ' (armed)' : ''}</span>
        )}
        {status === 'error' && <span className="schema-status-error">{error ?? 'gagal'}</span>}
      </div>
    </div>
  );
}

export default SchemaField;
