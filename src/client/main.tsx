import { hydrateRoot } from "react-dom/client";
import { islands } from "../ui/islands.js";
import "./styles.css";

// Hydrates each island the server rendered, with the props it rendered it
// with; the rest of the page stays the server's HTML.
for (const element of document.querySelectorAll<HTMLElement>("[data-island]")) {
  const Component = islands[element.dataset["island"] ?? ""];
  if (Component) hydrateRoot(element, <Component {...JSON.parse(element.dataset["props"] ?? "{}")} />);
}
