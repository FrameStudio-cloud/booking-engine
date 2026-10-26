import { render } from "preact";
import { Widget } from "./widget.jsx";
import styles from "./widget.css?inline";

/**
 * Mounts the widget inside a Shadow DOM so the host site's CSS
 * cannot touch it, and ours cannot leak out.
 *
 * Usage:
 *   <script src="widget.js" data-tenant="glow-salon" data-api="https://api.example.com"></script>
 */
const script = document.currentScript;
const tenantSlug = script?.dataset?.tenant ?? "glow-salon";
const apiBase = script?.dataset?.api ?? "";

const host = document.createElement("div");
document.body.appendChild(host);

const shadow = host.attachShadow({ mode: "open" });

const style = document.createElement("style");
style.textContent = styles;
shadow.appendChild(style);

const mount = document.createElement("div");
shadow.appendChild(mount);

render(<Widget tenantSlug={tenantSlug} apiBase={apiBase} />, mount);
