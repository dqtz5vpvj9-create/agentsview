import { mount } from "svelte";
import App from "./App.svelte";
import "@kenn-io/kit-ui/theme.css";
import "@kenn-io/kit-ui/mermaid.css";
import "./app.css";
import { initI18n } from "./lib/i18n/index.js";
import { installPerfFetchInstrumentation } from "./lib/stores/perf.svelte.js";
import { installSessionRangeSelection } from "./lib/utils/session-range-selection.js";
import { installSidebarScrollMemory } from "./lib/utils/sidebar-scroll-memory.js";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Root element 'app' not found. Cannot mount application.");
}

installPerfFetchInstrumentation();
installSessionRangeSelection();
installSidebarScrollMemory();
initI18n();

mount(App, { target });
