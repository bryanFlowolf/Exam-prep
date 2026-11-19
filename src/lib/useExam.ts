import { useCallback, useEffect, useState } from 'react';
import { loadExam, type ExamData } from './data';

// Small in-memory cache so moving between an exam's pages does not refetch everything.
const cache = new Map<string, ExamData>();

export function updateCachedExam(slug: string, fn: (d: ExamData) => ExamData) {
  const d = cache.get(slug);
  if (d) cache.set(slug, fn(d));
}

export function useExam(slug: string, userId: string) {
  const [data, setData] = useState<ExamData | null>(cache.get(slug) || null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const d = await loadExam(slug, userId);
      cache.set(slug, d);
      setData(d);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido cargar el examen.');
    }
  }, [slug, userId]);

  useEffect(() => {
    setData(cache.get(slug) || null);
    reload();
  }, [slug, reload]);

  const update = useCallback((fn: (d: ExamData) => ExamData) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      cache.set(slug, next);
      return next;
    });
  }, [slug]);

  return { data, error, reload, update };
}
