// Customers page. Built in its stage; this placeholder keeps navigation working until then.
import { empty, h, pageHead } from "../core.js";

export async function render(view) {
  view.replaceChildren(pageHead("M&K Hub", "Customers"), empty("This section is being built.", "customers"));
}
