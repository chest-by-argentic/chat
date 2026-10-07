import type { ComponentType } from "react";
import { Chat } from "./Chat.js";

// The components that run in the browser too, by name: the server renders
// them inside <Island>, the browser hydrates them (src/client/main.tsx).
export const islands: Record<string, ComponentType<any>> = { Chat };

export function Island<P extends object>({ name, props }: { name: keyof typeof islands; props: P }) {
  const Component = islands[name]!;
  return (
    <div data-island={name} data-props={JSON.stringify(props)}>
      <Component {...props} />
    </div>
  );
}
