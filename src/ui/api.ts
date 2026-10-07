// The page's calls to its tool (/chest/api), same origin, the member's
// session going with them. A refusal is thrown as ApiError(code); a
// network failure as ApiError("offline").

export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/chest/api" + path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError("offline", 0);
  }
  if (response.status === 204) return undefined as T;
  const answer = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new ApiError(answer?.error ?? "failed", response.status);
  return answer as T;
}

export const get = <T>(path: string) => call<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}) => call<T>("POST", path, body);
export const put = <T>(path: string, body: unknown) => call<T>("PUT", path, body);
export const patch = <T>(path: string, body: unknown) => call<T>("PATCH", path, body);
export const del = <T>(path: string) => call<T>("DELETE", path);

// upload sends a file to the Chest at the address the tool authorised,
// telling its progress (0 to 1): the name the Chest gave it.
export function upload(url: string, file: File, progress: (done: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = e => { if (e.lengthComputable) progress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status !== 201) return reject(new ApiError("upload_failed", xhr.status));
      try {
        resolve((JSON.parse(xhr.responseText) as { name: string }).name);
      } catch {
        reject(new ApiError("upload_failed", xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError("offline", 0));
    xhr.onabort = () => reject(new ApiError("aborted", 0));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}
