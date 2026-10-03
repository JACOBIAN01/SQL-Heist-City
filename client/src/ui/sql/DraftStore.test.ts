import { describe, expect, it } from 'vitest';
import { MemoryDraftStore, StorageDraftStore } from './DraftStore';

describe('MemoryDraftStore', () => {
  it('keeps drafts per task and treats empty text as no draft', () => {
    const store = new MemoryDraftStore();
    store.set('heal:small', 'SELECT 1');
    store.set('gun:rifle', 'SELECT 2');
    expect(store.get('heal:small')).toBe('SELECT 1');
    expect(store.get('gun:rifle')).toBe('SELECT 2');
    expect(store.get('nothing')).toBe('');
    store.set('heal:small', '');
    expect(store.get('heal:small')).toBe('');
    store.clear('gun:rifle');
    expect(store.get('gun:rifle')).toBe('');
  });
});

describe('StorageDraftStore', () => {
  const fakeStorage = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  };

  it('persists under a prefixed key and removes it when cleared', () => {
    const storage = fakeStorage();
    const store = new StorageDraftStore(storage);
    store.set('heal:small', 'SELECT 1');
    expect(storage.data.get('heist-draft:heal:small')).toBe('SELECT 1');
    expect(new StorageDraftStore(storage).get('heal:small')).toBe('SELECT 1');
    store.clear('heal:small');
    expect(storage.data.size).toBe(0);
  });

  it('keeps working in memory when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const store = new StorageDraftStore(broken);
    store.set('heal:small', 'SELECT 1');
    expect(store.get('heal:small')).toBe('SELECT 1');
    store.clear('heal:small');
    expect(store.get('heal:small')).toBe('');
  });
});
