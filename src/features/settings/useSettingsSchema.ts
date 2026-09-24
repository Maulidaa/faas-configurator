import { useCallback, useEffect, useState } from 'react';
import { sendPaginatedCommand, type DeviceClient } from '../../core/device';
import { settingSchemaListCommand } from '../../core/commands/registry';
import type { SettingFieldSchema } from '../../shared/types';

export interface UseSettingsSchemaResult {
  fields: SettingFieldSchema[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * features/settings/useSettingsSchema.ts
 * Menggabungkan seluruh halaman CMD_SETTING_SCHEMA_LIST lewat
 * sendPaginatedCommand (core/device) jadi satu array. Reload otomatis kalau
 * client berpindah atau `ready` berubah dari false ke true (mis. setelah
 * reconnect), plus reload manual lewat tombol retry di UI.
 */
/**
 * Firmware memecah grup besar (mis. "compass", ~380 byte) jadi beberapa node
 * grup ber-key sama supaya tiap node muat satu frame. Gabungkan kembali di
 * sini jadi satu grup, urutan anak dipertahankan.
 */
export function mergeGroupNodes(fields: SettingFieldSchema[]): SettingFieldSchema[] {
  const out: SettingFieldSchema[] = [];
  const groupIndex = new Map<string, number>();
  for (const f of fields) {
    if (f.type !== 'group') {
      out.push(f);
      continue;
    }
    const idx = groupIndex.get(f.key);
    if (idx === undefined) {
      groupIndex.set(f.key, out.length);
      out.push({ ...f, children: [...(f.children ?? [])] });
    } else {
      const target = out[idx];
      target.children = [...(target.children ?? []), ...(f.children ?? [])];
    }
  }
  return out;
}

export function useSettingsSchema(client: DeviceClient, ready: boolean): UseSettingsSchemaResult {
  const [fields, setFields] = useState<SettingFieldSchema[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    sendPaginatedCommand(client, settingSchemaListCommand, (page) => ({
      hasMore: page.hasMore,
      items: page.fields,
    }), { timeoutMs: 5000 })
      .then((allFields) => {
        if (!cancelled) setFields(mergeGroupNodes(allFields));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, ready, reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { fields, loading, error, reload };
}
