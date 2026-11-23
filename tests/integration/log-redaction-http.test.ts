import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { digest } from "../../src/server/modules/auth/crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cardsFixture,
  fixtureId,
  historicalSale,
} from "../helpers/cards-adversarial-fixture";
import { newId } from "../../src/server/lib/ids";

const root = process.cwd();
const canaries = {
  body: "synthetic-body-canary-WHR211",
  header: "synthetic-header-canary-WHR211",
  token: "synthetic-token-canary-WHR211",
  query: "synthetic-query-secret-WHR211",
  phone: "+2348000000211",
  exception: "synthetic-exception-canary-WHR211",
};
type Route = { file: string; pathname: string; methods: string[] };
async function inventory(directory: string): Promise<Route[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => inventory(path.join(directory, entry.name))),
  );
  const routes = nested.flat();
  if (entries.some((entry) => entry.name === "route.ts")) {
    const file = path.join(directory, "route.ts");
    const source = await readFile(file, "utf8");
    const methods = [
      ...source.matchAll(
        /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g,
      ),
    ].map((match) => match[1]!);
    for (const method of methods) {
      if (
        !new RegExp(
          `export\\s+const\\s+${method}\\s*=\\s*withOperationalTelemetry\\s*\\(`,
        ).test(source)
      )
        throw new Error(
          `Route export bypasses the sanitized exception boundary: ${path.relative(root, file)} ${method}`,
        );
    }
    if (!methods.length)
      throw new Error(
        `Route has no audited method: ${path.relative(root, file)}`,
      );
    routes.push({
      file,
      pathname:
        "/api/" +
        path
          .relative(path.join(root, "src/app/api"), directory)
          .split(path.sep)
          .join("/"),
      methods,
    });
  }
  return routes;
}
function family(route: Route) {
  const parts = route.pathname.split("/");
  return parts[2] === "admin" || parts[2] === "attendant"
    ? parts.slice(2, 4).join("/")
    : parts[2]!;
}

/** Run actual compiled route exports behind a real HTTP socket, with no handler mocks.
 * The route wrapper is the app exception boundary; deployed DO ingress/log settings
 * remain an Earl-run synthetic audit, not a claim made by this local transport. */
async function startServer(bundle: string, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [bundle], {
    cwd: root,
    env,
    stdio: "pipe",
  });
  let logs = "";
  let ready!: (url: string) => void;
  let reject!: (error: Error) => void;
  const listening = new Promise<string>((resolve, fail) => {
    ready = resolve;
    reject = fail;
  });
  child.stdout.on("data", (chunk: Buffer) => {
    logs += chunk.toString();
    const match = /AUDIT_LISTENING (http:\/\/127\.0\.0\.1:\d+)/.exec(logs);
    if (match) ready(match[1]!);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    logs += chunk.toString();
  });
  child.once("error", reject);
  child.once("exit", (code) => {
    if (!/AUDIT_LISTENING/.test(logs))
      reject(new Error(`HTTP audit child failed (${code}): ${logs}`));
  });
  const timer = setTimeout(
    () => reject(new Error("HTTP audit child did not listen")),
    15000,
  );
  const url = await listening.finally(() => clearTimeout(timer));
  return { child, url, logs: () => logs };
}
async function stopServer(server: { child: ChildProcessWithoutNullStreams }) {
  if (server.child.exitCode !== null) return;
  const exited = once(server.child, "exit");
  server.child.kill("SIGTERM");
  const timer = setTimeout(() => server.child.kill("SIGKILL"), 5000);
  await exited.finally(() => clearTimeout(timer));
}

describe("WHR-211 real HTTP route-family log-redaction audit", () => {
  let f: Awaited<ReturnType<typeof cardsFixture>>;
  let routes: Route[];
  let server: Awaited<ReturnType<typeof startServer>>;
  let directory: string;
  let bundle: string;
  let owner: string;
  let attendant: string;
  let sale: string;
  let sequence = 0;
  const statuses = new Map<string, number[]>();
  const originalEnv = { ...process.env };
  beforeAll(async () => {
    f = await cardsFixture();
    owner = await f.owner();
    attendant = randomBytes(32).toString("hex");
    const context = newId();
    await f.pool.query(
      `INSERT INTO capture_context(id,attendant_id,assignment_id,signed_in_at,offline_expires_at,seller_name,seller_username,device_binding_digest)
      VALUES($1,$2,$3,clock_timestamp(),clock_timestamp()+interval '24 hours','Grace Okon','grace.okon','fictional-redaction-device')`,
      [context, fixtureId(6), fixtureId(18)],
    );
    await f.pool.query(
      `INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,assignment_id,capture_context_id,created_at)
      VALUES($1,$2,$3,clock_timestamp()+interval '1 day',1,clock_timestamp(),$4,$5,clock_timestamp())`,
      [newId(), fixtureId(3), digest(attendant), fixtureId(18), context],
    );
    sale = (await historicalSale(f.pool, {})).id;
    routes = (await inventory(path.join(root, "src/app/api"))).sort((a, b) =>
      a.file.localeCompare(b.file),
    );
    directory = await mkdtemp(
      path.join(root, "node_modules/.whr211-http-audit-"),
    );
    bundle = path.join(directory, "routes.mjs");
    const imports = routes
      .map(
        (route, index) =>
          `import * as r${index} from ${JSON.stringify(route.file)};`,
      )
      .join("\n");
    const entries = routes
      .map(
        (route, index) =>
          `{ path: ${JSON.stringify(route.pathname)}, module: r${index} }`,
      )
      .join(",\n");
    await build({
      stdin: {
        contents: `${imports}
import { createServer } from 'node:http';
import { database } from ${JSON.stringify(path.join(root, "src/server/lib/db.ts"))};
import { logger } from ${JSON.stringify(path.join(root, "src/server/lib/logger.ts"))};
import { withOperationalTelemetry } from ${JSON.stringify(path.join(root, "src/server/modules/monitoring/telemetry.ts"))};
const routes=[${entries}].sort((a,b)=>(a.path.match(/\\[/g)?.length??0)-(b.path.match(/\\[/g)?.length??0));
const server=createServer(async (incoming,outgoing)=>{
 try {
  const url=new URL(incoming.url,'http://127.0.0.1');
  if(url.pathname==='/__audit/exception') {
    const chunks=[];for await(const chunk of incoming)chunks.push(chunk);
    const response=await withOperationalTelemetry(async()=>{throw new Error(incoming.url+JSON.stringify(incoming.headers)+Buffer.concat(chunks).toString());})();
    outgoing.statusCode=response.status;outgoing.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(url.pathname==='/__audit/logger') {
    logger.child({context:${JSON.stringify(canaries.body)},headers:{arbitrary:${JSON.stringify(canaries.header)}}}).error({event:'database.pool_failed',arbitrary:${JSON.stringify(canaries.query)},error:new Error(${JSON.stringify(canaries.exception)}),payload:{value:${JSON.stringify(canaries.phone)}}},${JSON.stringify(canaries.token)});
    logger.error(new Error(${JSON.stringify(canaries.exception)}));
    outgoing.end('logger probe');return;
  }
  const actual=url.pathname.split('/');
  let selected,params;
  for(const route of routes){
   const template=route.path.split('/');
   if(template.length!==actual.length)continue;
   const candidate={};let match=true;
   for(let i=0;i<template.length;i++){
    if(template[i].startsWith('['))candidate[template[i].slice(1,-1)]=decodeURIComponent(actual[i]);
    else if(template[i]!==actual[i]){match=false;break;}
   }
   if(match){selected=route;params=candidate;break;}
  }
  const handler=selected?.module[incoming.method];
  if(!handler){outgoing.statusCode=404;outgoing.end();return;}
  const chunks=[];for await(const chunk of incoming)chunks.push(chunk);
  const body=Buffer.concat(chunks);
  const request=new Request('https://cards.example.test'+incoming.url,{method:incoming.method,headers:incoming.headers,...(body.length?{body,duplex:'half'}:{})});
  const response=await handler(request,{params:Promise.resolve(params)});
  outgoing.statusCode=response.status;
  response.headers.forEach((value,key)=>outgoing.setHeader(key,value));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){
  // Transport failures fail the test; never swallow them as proof of route safety.
  process.stderr.write('AUDIT_UNHANDLED '+String(error?.stack??error)+'\\n');
  outgoing.statusCode=500;outgoing.end('audit transport failure');
 }
});
server.listen(0,'127.0.0.1',()=>process.stdout.write('AUDIT_LISTENING http://127.0.0.1:'+server.address().port+'\\n'));
process.on('SIGTERM',()=>{server.close(async()=>{await database().end();process.exit(0);});server.closeIdleConnections();});`,
        resolveDir: root,
        sourcefile: "log-redaction-http-entry.ts",
      },
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      tsconfig: path.join(root, "tsconfig.json"),
    });
    server = await startServer(bundle, {
      ...process.env,
      NEXT_PHASE: "phase-production-build",
      EMAIL_PROVIDER: "noop",
      NODE_PATH: path.join(root, "node_modules"),
    });
  }, 60000);
  afterAll(async () => {
    if (server) await stopServer(server);
    await f?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    for (const key of Object.keys(process.env))
      if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });
  function concrete(route: Route) {
    return route.pathname.replace(/\[([^\]]+)\]/g, (_, name: string) =>
      name === "productCode"
        ? "pms"
        : name === "purchaseId"
          ? sale
          : fixtureId(999),
    );
  }
  async function call(
    route: Route,
    method: string,
    mode: "unauthenticated" | "query" | "malformed" | "authenticated",
  ) {
    const pathname =
      concrete(route) +
      (mode === "query"
        ? `?secret=${canaries.query}&phone=${encodeURIComponent(canaries.phone)}`
        : "");
    const response = await fetch(server.url + pathname, {
      method,
      headers: {
        origin: "https://cards.example.test",
        "content-type": "application/json",
        "idempotency-key": newId(),
        "x-test-ip": `198.18.${Math.floor(++sequence / 250)}.${(sequence % 250) + 1}`,
        "x-private-canary": canaries.header,
        authorization: `Bearer ${canaries.token}`,
        ...(mode === "unauthenticated"
          ? {}
          : {
              cookie: `__Host-whr-admin-session=${owner}; secret=${canaries.token}`,
            }),
      },
      ...(!["GET", "HEAD"].includes(method)
        ? {
            body:
              mode === "malformed"
                ? `{"payload":"${canaries.body}","phone":"${canaries.phone}"`
                : JSON.stringify({
                    arbitrary: canaries.body,
                    phone: canaries.phone,
                    token: canaries.token,
                  }),
          }
        : {}),
      signal: AbortSignal.timeout(10000),
    });
    await response.arrayBuffer();
    const values = statuses.get(family(route)) ?? [];
    values.push(response.status);
    statuses.set(family(route), values);
    expect(
      response.status,
      `${method} ${route.pathname} (${mode})`,
    ).toBeLessThan(500);
  }
  function expectClean(logs: string) {
    expect(logs).not.toContain("AUDIT_UNHANDLED");
    for (const value of Object.values(canaries))
      expect(logs).not.toContain(value);
    expect(logs).not.toContain(owner);
    expect(logs).not.toContain(attendant);
  }
  it("audits every real route export with unauthenticated, query and malformed-body canaries", async () => {
    expect(routes.length).toBeGreaterThanOrEqual(137);
    for (const route of routes)
      for (const method of route.methods) {
        await call(route, method, "unauthenticated");
        await call(route, method, "query");
        if (!["GET", "HEAD"].includes(method))
          await call(route, method, "malformed");
      }
    expect([...statuses.keys()].sort()).toEqual(
      [...new Set(routes.map(family))].sort(),
    );
    expectClean(server.logs());
  }, 120000);
  it("audits successful protected and public reads with secret-bearing headers", async () => {
    const paths = [
      "/api/health",
      "/api/admin/session",
      "/api/admin/permissions",
      "/api/admin/roles",
      "/api/admin/assignable-roles",
      "/api/admin/products",
      "/api/admin/pumps",
      "/api/admin/prices",
      "/api/admin/settings",
      "/api/admin/giveaway/campaign",
      "/api/admin/overview",
      "/api/admin/card-batches",
      "/api/admin/access-history",
      "/api/admin/assignment-candidates",
      "/api/admin/monitoring",
      "/api/admin/monitoring/deploy-check",
    ];
    for (const pathname of paths) {
      const route = routes.find((entry) => entry.pathname === pathname)!;
      await call(route, "GET", "authenticated");
      expect(statuses.get(family(route))!.at(-1), pathname).toBe(200);
    }
    expectClean(server.logs());
  }, 30000);
  it("keeps successful search bodies, phone searches and authenticated attendant reads out of logs", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const successes: {
      pathname: string;
      body?: unknown;
      attendant?: boolean;
    }[] = [
      {
        pathname: "/api/admin/customers/search",
        body: { query: canaries.phone },
      },
      { pathname: "/api/admin/users/search", body: { query: canaries.body } },
      {
        pathname: "/api/admin/attendants/search",
        body: { query: canaries.body },
      },
      { pathname: "/api/admin/sales/search", body: { query: canaries.phone } },
      { pathname: "/api/admin/audit/search", body: { query: canaries.phone } },
      {
        pathname: "/api/admin/reports/query",
        body: { from: day, to: day, product: null, groupBy: "product" },
      },
      { pathname: "/api/admin/leaderboards?basis=recorded_all_time" },
      { pathname: "/api/admin/release-proposals/pending" },
      { pathname: "/api/attendant/session", attendant: true },
      { pathname: "/api/attendant/configured-assignment", attendant: true },
      { pathname: "/api/attendant/sales", attendant: true },
      { pathname: `/api/admin/sales/${sale}` },
      { pathname: `/api/admin/sales/${sale}/history?kind=revisions` },
    ];
    for (const entry of successes) {
      const response = await fetch(server.url + entry.pathname, {
        method: entry.body ? "POST" : "GET",
        headers: {
          origin: "https://cards.example.test",
          "content-type": "application/json",
          cookie: entry.attendant
            ? `__Host-whr-session=${attendant}`
            : `__Host-whr-admin-session=${owner}`,
          "x-private-canary": canaries.header,
          authorization: `Bearer ${canaries.token}`,
          "x-test-ip": `198.19.0.${(++sequence % 250) + 1}`,
        },
        ...(entry.body ? { body: JSON.stringify(entry.body) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      await response.arrayBuffer();
      expect(response.status, entry.pathname).toBe(200);
    }
    expectClean(server.logs());
  }, 30000);
  it("sanitizes real PostgreSQL connection failures across every route family", async () => {
    const failing = await startServer(bundle, {
      ...process.env,
      DATABASE_URL:
        "postgresql://fictional:fictional@127.0.0.1:1/synthetic-db-canary-WHR211",
      NEXT_PHASE: "phase-production-build",
      EMAIL_PROVIDER: "noop",
    });
    try {
      const covered = new Set<string>();
      let unavailable = 0;
      for (const route of routes) {
        if (covered.has(family(route))) continue;
        covered.add(family(route));
        const method = route.methods[0]!;
        const response = await fetch(failing.url + concrete(route), {
          method,
          headers: {
            origin: "https://cards.example.test",
            "content-type": "application/json",
            "idempotency-key": newId(),
            cookie: `__Host-whr-admin-session=${owner}`,
            "x-private-canary": canaries.header,
            authorization: `Bearer ${canaries.token}`,
          },
          ...(!["GET", "HEAD"].includes(method)
            ? {
                body: JSON.stringify({
                  arbitrary: canaries.body,
                  phone: canaries.phone,
                }),
              }
            : {}),
          signal: AbortSignal.timeout(10000),
        });
        await response.arrayBuffer();
        expect(response.status).not.toBe(500);
        if (response.status === 503) unavailable++;
      }
      expect(unavailable).toBeGreaterThan(10);
      expectClean(failing.logs());
      expect(failing.logs()).not.toContain("synthetic-db-canary-WHR211");
    } finally {
      await stopServer(failing);
    }
  }, 60000);
  it("contains thrown raw request exceptions before the framework can log them", async () => {
    const response = await fetch(
      server.url + `/__audit/exception?secret=${canaries.query}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${canaries.token}`,
          "x-private-canary": canaries.header,
        },
        body: JSON.stringify({ content: canaries.body, phone: canaries.phone }),
      },
    );
    expect(response.status).toBe(500);
    const body = await response.text();
    for (const value of Object.values(canaries))
      expect(body).not.toContain(value);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.logs()).toContain("api.unhandled_failure");
    expectClean(server.logs());
  });
  it("drops untrusted messages, arbitrary body/header/query fields and raw exceptions at the logger boundary", async () => {
    expect((await fetch(server.url + "/__audit/logger")).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.logs()).toContain("database.pool_failed");
    expectClean(server.logs());
  });
});
