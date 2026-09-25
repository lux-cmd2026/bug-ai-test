const http = require("node:http");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);

const state = {
  submissions: [],
  nextSubmissionId: 1,
  items: [
    { id: 1, name: "alpha", value: "old" },
    { id: 2, name: "beta", value: "new" }
  ],
  users: {
    alice: { id: "alice", role: "user", tokenVersion: 1 },
    admin: { id: "admin", role: "admin", tokenVersion: 1 }
  }
};

const sessions = new Map([
  ["demo-user-token", { userId: "alice", version: 1 }],
  ["demo-admin-token", { userId: "admin", version: 1 }]
]);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function getSession(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return sessions.get(token) || null;
}

// BUG #1 — no idempotency key and no server-side duplicate protection.
async function submit(req, res) {
  const body = await readBody(req);
  await new Promise(resolve => setTimeout(resolve, 80));

  const submission = {
    id: state.nextSubmissionId++,
    text: String(body.text || ""),
    createdAt: Date.now()
  };
  state.submissions.push(submission);
  json(res, 201, submission);
}

// BUG #2 — state exists only in the browser in the challenge UI.
// The API deliberately returns no persisted view state.
function getItems(req, res) {
  const url = new URL(req.url, "http://localhost");
  const q = url.searchParams.get("q") || "";
  const filtered = state.items.filter(item =>
    item.name.includes(q) || item.value.includes(q)
  );
  json(res, 200, { items: filtered });
}

// BUG #3 — response latency depends on the query and there is no request
// versioning/cancellation on the client. A slow old response can overwrite a new one.
async function search(req, res) {
  const url = new URL(req.url, "http://localhost");
  const q = url.searchParams.get("q") || "";
  const delay = q === "old" ? 220 : 20;
  await new Promise(resolve => setTimeout(resolve, delay));
  const items = state.items.filter(item =>
    item.name.includes(q) || item.value.includes(q)
  );
  json(res, 200, { q, items });
}

function issueToken(userId) {
  const user = state.users[userId];
  const token = userId + "-token-v" + user.tokenVersion;
  sessions.set(token, { userId, version: user.tokenVersion });
  return token;
}

// BUG #4a — concurrent refreshes can issue different token versions.
async function refresh(req, res) {
  const body = await readBody(req);
  const user = state.users[String(body.userId)];
  if (!user) return json(res, 401, { error: "unknown user" });

  await new Promise(resolve => setTimeout(resolve, 60));
  user.tokenVersion += 1;
  const token = issueToken(user.id);
  json(res, 200, { accessToken: token, version: user.tokenVersion });
}

// BUG #4b — object-level authorization is missing: any authenticated user can
// request any user's private item by supplying another userId.
function privateData(req, res) {
  const session = getSession(req);
  if (!session) return json(res, 401, { error: "unauthorized" });

  const url = new URL(req.url, "http://localhost");
  const requestedUser = url.searchParams.get("userId") || session.userId;
  json(res, 200, {
    requestedUser,
    secret: "private-data-for-" + requestedUser
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(require("node:fs").readFileSync("public/index.html"));
    }
    if (req.method === "POST" && req.url === "/api/submit") return submit(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/items")) return getItems(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/search")) return search(req, res);
    if (req.method === "POST" && req.url === "/api/auth/refresh") return refresh(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/private")) return privateData(req, res);
    json(res, 404, { error: "not found" });
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log("bug-ai-test listening on http://localhost:" + PORT);
  });
}

module.exports = { server, state, sessions };
