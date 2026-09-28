import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const environment of ["production", "development", ""]) {
  test(`module availability: ${environment || "unset"}`, () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import jwt from "jsonwebtoken";
      const { app } = await import("./dist/src/app.js");
      const { pool } = await import("./dist/src/db.js");
      pool.query = async (sql) => ({ rowCount: 1, rows: sql.includes("information_schema") ? [{exists:1}] : [{id:"test-admin",name:"Admin",email:"test@example.test",role:"admin",is_active:true,workspace:"expedicao"}] });
      const server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      const base = "http://127.0.0.1:" + server.address().port;
      try {
        assert.equal((await fetch(base + "/health")).status, 200);
        for (const path of ["/ti/records", "/ti-stock/products"]) {
          assert.equal((await fetch(base + path)).status, 404, path);
        }
        assert.equal((await fetch(base + "/stock/base")).status, process.env.NODE_ENV === "development" ? 401 : 404);
        const token = jwt.sign({sub:"test-admin",role:"admin",is_active:true,workspace:"expedicao"}, process.env.JWT_SECRET);
        const response = await fetch(base + "/settings/workspaces/me", {headers:{Authorization:"Bearer " + token}});
        assert.deepEqual((await response.json()).workspaces, process.env.NODE_ENV === "development" ? ["expedicao", "estoque"] : ["expedicao"]);
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await pool.end();
      }
    `], { cwd: new URL("../", import.meta.url), env: { ...process.env, NODE_ENV: environment, DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test", JWT_SECRET: "module-availability-test-only" }, encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
