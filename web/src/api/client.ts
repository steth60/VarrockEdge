export class ApiError extends Error {
  constructor(public status: number, public payload: any) {
    super(typeof payload === 'string' ? payload : payload?.error ?? `HTTP ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: any): Promise<T> {
  // X-Varrok-CSRF marks the request as first-party. A cross-site page cannot
  // set a custom header without a CORS preflight, which the server never
  // grants — so the server rejects any mutating request that lacks it.
  const headers: Record<string, string> = { 'X-Varrok-CSRF': '1' };
  if (body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, body?: any) => request<T>('POST', p, body),
  patch: <T = any>(p: string, body?: any) => request<T>('PATCH', p, body),
  delete: <T = any>(p: string) => request<T>('DELETE', p),
};
