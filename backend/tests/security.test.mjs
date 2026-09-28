import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import express from "express";

process.env.NODE_ENV = "production";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.JWT_SECRET = "security-regression-test-only";
const { app } = await import("../dist/src/app.js");
const { pool } = await import("../dist/src/db.js");
const { createLoginLimiter } = await import("../dist/src/middleware/loginLimit.js");
const { detectImageFormat } = await import("../dist/src/services/imageFormat.js");
const { csvCell } = await import("../dist/src/services/csv.js");
const { errorHandler } = await import("../dist/src/middleware/error.js");
const { authRequired, requireRole, requireScreenAccess } = await import("../dist/src/middleware/auth.js");
const { imageUpload } = await import("../dist/src/services/uploads.js");

const id = "00000000-0000-4000-8000-000000000001";
const targetId = "00000000-0000-4000-8000-000000000002";
let activeUser = { id, name:"Test", email:"test@example.test", role:"admin", is_active:true, workspace:"expedicao" };
let databaseDown = false;
let permissionsDown = false;
pool.query = async (sql, params) => {
  if (databaseDown || (permissionsDown && sql.includes("to_regclass"))) throw new Error("secret database error");
  if (sql.includes("information_schema")) return { rowCount: 1, rows: [{ exists: 1 }] };
  if (sql.includes("to_regclass")) return { rowCount: 1, rows: [{ table_name: null }] };
  if (sql.includes("SELECT id, email, is_active, role")) return { rowCount:1, rows:[{id:targetId,role:"admin",is_active:true,email:"admin@example.test"}] };
  if (sql.includes("FROM users WHERE id")) return { rowCount: activeUser ? 1 : 0, rows: activeUser ? [activeUser] : [] };
  throw new Error("Unexpected SQL in isolated test: " + sql);
};
const harness = express();
harness.use(express.json());
harness.get("/admin", authRequired, requireRole(["admin"]), (_req,res) => res.json({ok:true}));
harness.get("/screen", authRequired, requireScreenAccess("dashboard"), (_req,res) => res.json({ok:true}));
harness.post("/login", createLoginLimiter(2, 500), (_req,res) => res.status(401).json({}));
harness.post("/image", imageUpload.single("image"), (_req,res) => res.json({ok:true}));
harness.get("/error", () => { throw new Error("password and SQL must not leak"); });
harness.use(errorHandler);
let server, harnessServer, base, testBase;
before(async () => {
  server = app.listen(0,"127.0.0.1");
  harnessServer = harness.listen(0,"127.0.0.1");
  await Promise.all([server,harnessServer].map((s) => new Promise((resolve) => s.once("listening",resolve))));
  base = "http://127.0.0.1:" + server.address().port;
  testBase = "http://127.0.0.1:" + harnessServer.address().port;
});
after(async () => {
  await Promise.all([server,harnessServer].map((s) => new Promise((resolve) => s.close(resolve))));
  await pool.end();
});
function headers() { return {Authorization:"Bearer " + jwt.sign({sub:id,role:"admin",is_active:true},process.env.JWT_SECRET),"Content-Type":"application/json"}; }

test("missing and forged tokens are rejected", async () => {
  assert.equal((await fetch(testBase+"/admin")).status,401);
  assert.equal((await fetch(testBase+"/admin",{headers:{Authorization:"Bearer forged"}})).status,401);
});
test("disabled accounts cannot reuse existing JWTs", async () => {
  activeUser.is_active=false;
  try { assert.equal((await fetch(testBase+"/admin",{headers:headers()})).status,403); }
  finally { activeUser.is_active=true; }
});
test("current database role overrides old admin claim", async () => {
  activeUser.role="operator";
  try { assert.equal((await fetch(testBase+"/admin",{headers:headers()})).status,403); }
  finally { activeUser.role="admin"; }
});
test("authentication and permission checks fail closed during database outages", async () => {
  databaseDown=true;
  try { assert.equal((await fetch(testBase+"/admin",{headers:headers()})).status,503); }
  finally { databaseDown=false; }
  permissionsDown=true;
  try { assert.equal((await fetch(testBase+"/screen",{headers:headers()})).status,503); }
  finally { permissionsDown=false; }
});
test("supervisor cannot create admin or edit an administrator", async () => {
  activeUser.role="supervisor";
  try {
    const create=await fetch(base+"/users",{method:"POST",headers:headers(),body:JSON.stringify({name:"Test",email:"test@example.test",password:"test-only",role:"admin"})});
    assert.equal(create.status,403);
    const update=await fetch(base+"/users/"+targetId,{method:"PATCH",headers:headers(),body:JSON.stringify({password:"test-only"})});
    assert.equal(update.status,403);
  } finally { activeUser.role="admin"; }
});
test("unexpected errors do not expose internal details",async () => {
  const response=await fetch(testBase+"/error");
  assert.equal(response.status,500);
  assert.deepEqual(await response.json(),{message:"Erro interno."});
});
test("login throttles repeated attempts and expires",async () => {
  for(let i=0;i<2;i++) assert.equal((await fetch(testBase+"/login",{method:"POST"})).status,401);
  const limited=await fetch(testBase+"/login",{method:"POST"});
  assert.equal(limited.status,429);
  assert.ok(limited.headers.get("retry-after"));
  await new Promise((resolve)=>setTimeout(resolve,550));
  assert.equal((await fetch(testBase+"/login",{method:"POST"})).status,401);
});
test("image signatures are checked independently of supplied extension and MIME",() => {
  assert.throws(()=>detectImageFormat(Buffer.from('<svg onload="alert(1)"></svg>')),{status:415});
  assert.throws(()=>detectImageFormat(Buffer.from('<html>malicious</html>')),{status:415});
  assert.equal(detectImageFormat(Buffer.from([255,216,255,0])).contentType,"image/jpeg");
  assert.equal(detectImageFormat(Buffer.from([137,80,78,71,13,10,26,10])).ext,".png");
});
test("oversized images rejected before processing",async () => {
  const body=new FormData(); body.append("image",new Blob([new Uint8Array(10*1024*1024+1)]),"photo.jpg");
  assert.equal((await fetch(testBase+"/image",{method:"POST",body})).status,413);
});
test("CSV cells escape quotes, commas and formula prefixes",() => {
  assert.equal(csvCell('a,"b"'),'"a,""b"""');
  for(const value of ['=1+1',' +SUM(A1)','@x','-1+2','\t=1']) assert.equal(csvCell(value).charCodeAt(1),39);
});
test("CORS does not allow arbitrary origins and security headers are set",async () => {
  const response=await fetch(base+"/health",{headers:{Origin:"https://attacker.invalid"}});
  assert.equal(response.headers.get("access-control-allow-origin"),null);
  assert.equal(response.headers.get("x-content-type-options"),"nosniff");
  assert.equal(response.headers.get("x-powered-by"),null);
});
test("invalid dates are rejected before KPI queries",async () => {
  assert.equal((await fetch(base+"/kpi?from=2026-02-30&to=2026-03-01",{headers:headers()})).status,400);
  assert.equal((await fetch(base+"/kpi?from=2026-03-02&to=2026-03-01",{headers:headers()})).status,400);
});

for (const fail of [false, true]) {
  test(`permission updates ${fail ? "roll back" : "commit"} on a single connection`, async () => {
    const query = pool.query;
    const connect = pool.connect;
    const statements = [];
    let released = false;
    pool.query = async (sql, params) => {
      if (sql.includes("CREATE TABLE") || sql.includes("INSERT INTO role_screen_permissions") || sql.includes("INSERT INTO audit_log")) return {rowCount:1,rows:[]};
      return query(sql, params);
    };
    pool.connect = async () => ({
      query: async (sql) => {
        statements.push(sql.trim().split(/\s+/)[0]);
        if (fail && sql.includes("INSERT INTO role_screen_permissions")) throw new Error("test transaction failure");
        return {rowCount:1,rows:[]};
      },
      release: () => { released = true; },
    });
    try {
      const response = await fetch(base+"/settings/access",{method:"PUT",headers:headers(),body:JSON.stringify({permissions:[{role:"operator",screen_key:"dashboard",is_enabled:false}]})});
      assert.equal(response.status,fail ? 500 : 200);
      assert.deepEqual(statements,["BEGIN","INSERT",fail ? "ROLLBACK" : "COMMIT"]);
      assert.equal(released,true);
    } finally {
      pool.query = query;
      pool.connect = connect;
    }
  });
}
