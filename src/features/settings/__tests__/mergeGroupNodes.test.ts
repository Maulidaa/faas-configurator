import { describe, expect, it } from 'vitest';
import { mergeGroupNodes } from '../useSettingsSchema';
import type { SettingFieldSchema } from '../../../shared/types';

const leaf = (key: string): SettingFieldSchema => ({ key, label: key, type: 'number' }) as SettingFieldSchema;
const group = (key: string, kids: string[]): SettingFieldSchema =>
  ({ key, label: key, type: 'group', children: kids.map(leaf) }) as SettingFieldSchema;

describe('mergeGroupNodes', () => {
  it('menggabungkan node grup ber-key sama (pecahan dari firmware), urutan anak terjaga', () => {
    const merged = mergeGroupNodes([group('compass', ['a', 'b']), group('compass', ['c']), leaf('x')]);
    expect(merged).toHaveLength(2);
    expect(merged[0].children?.map((c) => c.key)).toEqual(['a', 'b', 'c']);
    expect(merged[1].key).toBe('x');
  });

  it('tidak menyentuh grup berbeda dan leaf biasa', () => {
    const merged = mergeGroupNodes([group('g1', ['a']), group('g2', ['b']), leaf('y')]);
    expect(merged.map((f) => f.key)).toEqual(['g1', 'g2', 'y']);
  });
});
