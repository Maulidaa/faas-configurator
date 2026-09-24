import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DeviceClient } from '../../core/device';
import { settingCommitCommand, settingGetCommand, settingSetCommand } from '../../core/commands/registry';
import type { SettingFieldSchema, SettingValue } from '../../shared/types';

export type FieldSaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'rejected' | 'error';
export type CommitResult = 'idle' | 'ok' | 'rejected' | 'error';

export interface UseSettingValuesResult {
  values: Record<string, SettingValue>;
  statuses: Record<string, FieldSaveStatus>;
  fieldErrors: Record<string, string>;
  setValue: (field: SettingFieldSchema, value: SettingValue) => void;
  committing: boolean;
  commitResult: CommitResult;
  commit: () => void;
}

function flattenLeaves(fields: SettingFieldSchema[]): SettingFieldSchema[] {
  const out: SettingFieldSchema[] = [];
  const walk = (list: SettingFieldSchema[]) => {
    for (const f of list) {
      if (f.type === 'group' && f.children) {
        walk(f.children);
      } else {
        out.push(f);
      }
    }
  };
  walk(fields);
  return out;
}

/**
 * features/settings/useSettingValues.ts
 * Sekali schema siap, ambil nilai tiap leaf field satu-satu lewat
 * CMD_SETTING_GET (sekuensial — schema v1 tidak besar, dan ini menghindari
 * membanjiri device dengan puluhan command bersamaan lewat USB CDC).
 * setValue menulis ke RAM device via CMD_SETTING_SET segera (optimistic
 * update di UI, dikoreksi kalau device menolak); commit() memisahkan
 * "Apply" (SET, sudah terjadi per-field) dari "Commit to Flash" (COMMIT,
 * eksplisit lewat tombol) sesuai web-configurator-architecture.md Bagian 12.
 */
export function useSettingValues(client: DeviceClient, fields: SettingFieldSchema[]): UseSettingValuesResult {
  const [values, setValues] = useState<Record<string, SettingValue>>({});
  const [statuses, setStatuses] = useState<Record<string, FieldSaveStatus>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<CommitResult>('idle');

  // useMemo di sini bukan cuma optimisasi: identitas array `leaves` sengaja
  // dijaga stabil (hanya berubah kalau `fields` itu sendiri berubah, mis.
  // reload schema) supaya bisa dipakai langsung sebagai dependency effect
  // di bawah tanpa memicu refetch di tiap render.
  const leaves = useMemo(() => flattenLeaves(fields), [fields]);

  useEffect(() => {
    if (leaves.length === 0) return;
    let cancelled = false;

    (async () => {
      for (const field of leaves) {
        if (cancelled) return;
        setStatuses((s) => ({ ...s, [field.key]: 'loading' }));
        try {
          const value = await client.sendCommand(settingGetCommand, { key: field.key });
          if (cancelled) return;
          setValues((v) => ({ ...v, [field.key]: value }));
          setStatuses((s) => ({ ...s, [field.key]: 'idle' }));
        } catch (err) {
          if (cancelled) return;
          setStatuses((s) => ({ ...s, [field.key]: 'error' }));
          setFieldErrors((e) => ({ ...e, [field.key]: err instanceof Error ? err.message : String(err) }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, leaves]);

  const setValue = useCallback(
    (field: SettingFieldSchema, value: SettingValue) => {
      setValues((v) => ({ ...v, [field.key]: value }));
      setStatuses((s) => ({ ...s, [field.key]: 'saving' }));
      setFieldErrors((e) => {
        if (!(field.key in e)) return e;
        const next = { ...e };
        delete next[field.key];
        return next;
      });

      client
        .sendCommand(settingSetCommand, { key: field.key, type: field.type, value })
        .then((result) => {
          setStatuses((s) => ({ ...s, [field.key]: result.ok ? 'saved' : 'rejected' }));
        })
        .catch((err: unknown) => {
          setStatuses((s) => ({ ...s, [field.key]: 'error' }));
          setFieldErrors((e) => ({ ...e, [field.key]: err instanceof Error ? err.message : String(err) }));
        });
    },
    [client],
  );

  const commit = useCallback(() => {
    setCommitting(true);
    setCommitResult('idle');
    client
      .sendCommand(settingCommitCommand, undefined)
      .then((result) => setCommitResult(result.ok ? 'ok' : 'rejected'))
      .catch(() => setCommitResult('error'))
      .finally(() => setCommitting(false));
  }, [client]);

  return { values, statuses, fieldErrors, setValue, committing, commitResult, commit };
}
