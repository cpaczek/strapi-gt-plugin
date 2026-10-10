import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import type { z } from 'zod';
import { PLUGIN_ID } from '../../shared/constants';
import type { Diagnostic } from '../../shared/contracts';
import { requestDiagnostic } from './api';

export const useResource = <T>(
  path: string | null,
  schema: z.ZodType<T>,
  pollMs?: number
): { result?: T; error?: Diagnostic; loading: boolean; refresh: () => void } => {
  const { get } = useFetchClient();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string | null;
    result?: T;
    error?: Diagnostic;
    loading: boolean;
  }>({ key: path, loading: true });
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    let pending = false;
    const read = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await get<unknown>(`/${PLUGIN_ID}${path}`, { signal: controller.signal });
        const result = schema.parse(response.data);
        if (!controller.signal.aborted) setState({ key: path, result, loading: false });
      } catch (failure: unknown) {
        if (!controller.signal.aborted)
          setState((current) => ({
            key: path,
            ...(current.key === path ? { result: current.result } : {}),
            error: requestDiagnostic(failure),
            loading: false,
          }));
      } finally {
        pending = false;
      }
    };
    void read();
    const timer = pollMs ? setInterval(() => void read(), pollMs) : undefined;
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [get, path, schema, revision, pollMs]);
  return { ...(state.key === path ? state : { loading: true }), refresh };
};
export const useMutation = () => {
  const { post, put } = useFetchClient();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Diagnostic>();
  const run = async <T>(
    method: 'post' | 'put',
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    onSuccess: (result: T) => void,
    success?: Diagnostic
  ) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      const response = await (method === 'put' ? put : post)<unknown>(`/${PLUGIN_ID}${path}`, body);
      const result = schema.parse(response.data);
      onSuccess(result);
      if (success) setNotice(success);
    } catch (failure: unknown) {
      setNotice(requestDiagnostic(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return { run, busy, notice, setNotice };
};
