// Dev helper: force a full garbage collection in the Spotify window (to measure what sleep could free).
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find(t => t.type === "page" && t.url.includes("xpui"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let id = 0;
const call = (method, params = {}) => new Promise(ok => {
  const my = ++id;
  const h = ({ data }) => { const m = JSON.parse(data); if (m.id === my) { ws.removeEventListener("message", h); ok(m.result); } };
  ws.addEventListener("message", h);
  ws.send(JSON.stringify({ id: my, method, params }));
});
const heap = async () => (await call("Runtime.evaluate", { expression: "Math.round(performance.memory.usedJSHeapSize/1048576)+'/'+Math.round(performance.memory.totalJSHeapSize/1048576)", returnByValue: true })).result.value;
console.log("JS heap used/total MB before:", await heap());
await call("HeapProfiler.collectGarbage");
await call("Memory.simulatePressureNotification", { level: "critical" }).catch(() => {});
console.log("JS heap used/total MB after: ", await heap());
ws.close();
