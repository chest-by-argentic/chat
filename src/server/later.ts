// Work that follows an answer — live events, notifications, badges, files
// to delete — runs after it, so that a member's send is not slowed by the
// others' notices. A failure there is logged, never thrown at the member:
// the database is already right, and the next write or read sets the rest.

const running = new Set<Promise<void>>();

export function later(what: string, work: () => Promise<unknown>): void {
  const task = work().then(() => undefined, (error: unknown) => {
    console.error(`chat: ${what} failed: ${error instanceof Error ? error.message : "unknown error"}`);
  });
  running.add(task);
  void task.finally(() => running.delete(task));
}

// settled waits for the work started so far (tests, a stopping server).
export async function settled(): Promise<void> {
  while (running.size) await Promise.all([...running]);
}
