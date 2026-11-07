// Dev helper: reload the Spotify window and print every exception / console error for N seconds.
// Usage: node errors.mjs [seconds=12]
const secs = Number(process.argv[2] || 12);
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find(t => t.type === "page" && t.url.includes("xpui"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    console.log("EXCEPTION:", (d.exception?.description || d.text).split("\n").slice(0, 6).join("\n  "), "\n  at", d.url, d.lineNumber);
  } else if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
    console.log(m.params.type.toUpperCase() + ":", m.params.args.map(a => a.value ?? a.description ?? "").join(" ").slice(0, 400));
  }
};
send("Runtime.enable");
send("Page.enable");
send("Page.reload", { ignoreCache: true });
setTimeout(() => { ws.close(); process.exit(0); }, secs * 1000);
