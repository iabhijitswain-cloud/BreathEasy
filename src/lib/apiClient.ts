export async function getJson<TRes>(url: string, signal?: AbortSignal): Promise<TRes> {
  const res = await fetch(url, { signal });
  const data = (await res.json()) as TRes & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}

export async function postJson<TReq, TRes>(
  url: string,
  body: TReq,
  signal?: AbortSignal,
): Promise<TRes> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await res.json()) as TRes & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}
