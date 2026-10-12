export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data: unknown = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string" ? data.error : res.statusText;
    throw new ApiError(res.status, message);
  }
  return data as T;
}
