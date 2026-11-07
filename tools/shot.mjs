// Dev helper: screenshot the Spotify window. Usage: node shot.mjs out.png
import { writeFileSync } from "node:fs";
const out = process.argv[2] || "shot.png";
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find(t => t.type === "page" && t.url.includes("xpui"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.id !== 1) return;
  if (!m.result?.data) { console.error("no image", m.error); process.exit(1); }
  writeFileSync(out, Buffer.from(m.result.data, "base64"));
  console.log("saved", out);
  ws.close();
};
ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
