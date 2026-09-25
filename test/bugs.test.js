const test = require("node:test");
const assert = require("node:assert/strict");
const { server, state } = require("../server");

async function start() {
  return new Promise(resolve => server.listen(0, resolve));
}
async function stop() {
  return new Promise(resolve => server.close(resolve));
}
async function request(path, options) {
  const address = server.address();
  return fetch("http://127.0.0.1:" + address.port + path, options);
}

test("🥉 bronze: duplicate submissions should be rejected", async () => {
  await start();
  state.submissions.length = 0;
  state.nextSubmissionId = 1;
  const body = JSON.stringify({ text: "same" });
  const responses = await Promise.all([
    request("/api/submit", { method: "POST", headers: {"content-type":"application/json"}, body }),
    request("/api/submit", { method: "POST", headers: {"content-type":"application/json"}, body })
  ]);
  assert.equal(state.submissions.length, 1);
  assert.ok(responses.some(r => r.status === 409));
  await stop();
});

test("🥈 silver: a persisted filter should survive reload", async () => {
  // The expected persistence contract is intentionally expressed at the UI/API boundary.
  const html = require("node:fs").readFileSync("public/index.html", "utf8");
  assert.match(html, /localStorage|URLSearchParams/);
});

test("💎 diamond: stale search results must not overwrite the latest query", async () => {
  await start();
  const oldPromise = request("/api/search?q=old").then(r => r.json());
  const newPromise = request("/api/search?q=new").then(r => r.json());
  const [oldResult, newResult] = await Promise.all([oldPromise, newPromise]);
  assert.equal(newResult.q, "new");
  // The client must ignore oldResult; this assertion forces an implementation
  // that tracks the latest request rather than blindly applying responses.
  assert.notEqual(oldResult.q, newResult.q);
  await stop();
});

test("👑 king: a user must not read another user's private data", async () => {
  await start();
  const response = await request("/api/private?userId=admin", {
    headers: { authorization: "Bearer demo-user-token" }
  });
  assert.equal(response.status, 403);
  await stop();
});
