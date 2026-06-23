/** Thin wrapper around fetch with JSON body + error throwing on non-2xx. */

import type { UploadResponse } from "../shared/types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(res.status, errBody.error ?? `${res.status} ${res.statusText}`, errBody.code);
  }
  return (await res.json()) as T;
}

/** Multipart upload — browser sets Content-Type with boundary automatically. */
export async function apiUpload(file: File): Promise<UploadResponse> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(res.status, errBody.error ?? `${res.status} ${res.statusText}`, errBody.code);
  }
  return (await res.json()) as UploadResponse;
}
