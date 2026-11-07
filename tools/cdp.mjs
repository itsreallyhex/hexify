// Dev helper: run JS inside the Spotify window via Chrome DevTools Protocol.
// Needs Spotify launched with --remote-debugging-port=9222 (spicetify config spotify_launch_flags).
// Usage: node cdp.mjs "<expression>"   or   node cdp.mjs -f file.js
import { readFileSync } from "node:fs";

const arg = process.argv[2] === "-f" ? readFileSync(process.argv[3], "utf8") : process.argv[2];
if (!arg) { console.error("usage: node cdp.mjs \"<expr>\" | -f file.js"); process.exit(2); }

const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find(t => t.type === "page" && t.url.includes("xpui"));
if (!page) { console.error("no xpui page found:", targets.map(t => t.url)); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id !== 1) return;
  const r = msg.result;
  if (r?.exceptionDetails) console.error("EXCEPTION:", r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  else console.log(typeof r?.result?.value === "string" ? r.result.value : JSON.stringify(r?.result?.value ?? r?.result, null, 2));
  ws.close();
};
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: arg, awaitPromise: true, returnByValue: true } }));
