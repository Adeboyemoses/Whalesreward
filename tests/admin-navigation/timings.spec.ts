import { test, expect } from "@playwright/test";
import { fixture, signIn } from "../admin-access/admin-access.fixtures";
import { writeFile, mkdir } from "node:fs/promises";

test.use({ trace: "off", video: "off", screenshot: "off" });
for (const profile of [
  {
    name: "rtt150",
    latency: 150,
    downloadThroughput: -1,
    uploadThroughput: -1,
  },
  {
    name: "fast3g-shaped",
    latency: 562.5,
    downloadThroughput: 200000,
    uploadThroughput: 93750,
  },
]) {
  test(`local admin navigation timings ${profile.name}`, async ({
    page,
    context,
  }) => {
    test.setTimeout(180000);
    const f = await fixture();
    const events: {
      kind: string;
      at: number;
      discarded?: boolean;
      screen?: string;
    }[] = [];
    try {
      await f.db.query(
        "UPDATE auth_user SET must_change_password=false WHERE id=$1",
        [f.userId],
      );
      await signIn(page, f.username, f.password);
      await expect(page).toHaveURL(/\/admin$/);
      await context.exposeBinding("navTiming", (_source, event) => {
        events.push(event);
      });
      await context.addInitScript(() => {
        const send = (kind: string) =>
          (window as unknown as { navTiming(v: unknown): void }).navTiming({
            kind,
            screen: location.pathname
              .split("/")
              .filter(Boolean)
              .slice(1)
              .map((v, i) => (i === 0 ? v : "detail"))
              .join("-"),
            at: performance.timeOrigin + performance.now(),
            discarded: (document as Document & { wasDiscarded?: boolean })
              .wasDiscarded,
          });
        let ready = false;
        const check = () => {
          const p = location.pathname.split("/").filter(Boolean);
          const h = [...document.querySelectorAll("main h2")];
          const exists =
            p[1] === "users"
              ? p.length === 2
                ? h.some((e) => e.textContent === "Portal users") &&
                  !!document.querySelector("tbody tr")
                : h.some((e) =>
                    e.textContent?.startsWith("Manage admin user"),
                  ) && !!document.querySelector("select option")
              : p[1] === "roles"
                ? p.length === 2
                  ? h.some((e) => e.textContent === "Roles & permissions") &&
                    !!document.querySelector("tbody tr")
                  : document.querySelectorAll('input[type="checkbox"]')
                      .length === 28
                : false;
          if (exists !== ready) {
            ready = exists;
            send(exists ? "visible" : "blank");
          }
        };
        send("document");
        document.addEventListener(
          "click",
          (e) => {
            if ((e.target as Element).closest('a[href^="/admin/"]'))
              send("click");
          },
          true,
        );
        window.addEventListener(
          "focus",
          () => {
            send("focus");
            requestAnimationFrame(() => {
              check();
              if (ready) send("visible");
            });
          },
          true,
        );
        new MutationObserver(check).observe(document, {
          childList: true,
          subtree: true,
        });
        document.addEventListener("DOMContentLoaded", check);
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: profile.latency,
        downloadThroughput: profile.downloadThroughput,
        uploadThroughput: profile.uploadThroughput,
      });
      await page.goto("/admin/users");
      await expect(
        page.getByRole("heading", { name: "Portal users", exact: true }),
      ).toBeVisible();
      const samples: unknown[] = [];
      async function sample(
        operation: string,
        action: () => Promise<unknown>,
        readiness: () => Promise<void>,
      ) {
        const expectedScreen = (
          {
            "tab-return": "users",
            "user-open": "users-detail",
            "section-change": "roles",
            "role-open": "roles-detail",
          } as Record<string, string>
        )[operation];
        const from = events.length;
        const start = await page.evaluate(
          () => performance.timeOrigin + performance.now(),
        );
        await action();
        await readiness();
        await expect
          .poll(() =>
            events
              .slice(from)
              .some(
                (e) =>
                  e.kind === "visible" &&
                  e.at >= start &&
                  e.screen === expectedScreen,
              ),
          )
          .toBe(true);
        const captured = events.slice(from);
        const trigger =
          captured.find(
            (e) => e.kind === (operation === "tab-return" ? "focus" : "click"),
          )?.at ?? start;
        const end = captured.find(
          (e) =>
            e.kind === "visible" &&
            e.at >= trigger &&
            e.screen === expectedScreen,
        )!.at;
        const blank = captured.find((e) => e.kind === "blank");
        samples.push({
          operation,
          durationMs: +(end - trigger).toFixed(1),
          blankMs: blank ? +(end - blank.at).toFixed(1) : 0,
          documents: captured.filter((e) => e.kind === "document").length,
          discarded: captured.some((e) => e.discarded),
          marks: captured,
        });
      }
      for (let repeat = 0; repeat < 3; repeat++) {
        await sample(
          "tab-return",
          () => page.evaluate(() => window.dispatchEvent(new Event("focus"))),
          () =>
            expect(
              page.getByRole("heading", { name: "Portal users", exact: true }),
            ).toBeVisible(),
        );
        await sample(
          "user-open",
          () =>
            page
              .getByRole("row")
              .filter({ hasText: f.username })
              .getByRole("link", { name: "Manage", exact: true })
              .click(),
          () =>
            expect(
              page.getByRole("heading", { name: /^Manage admin user/ }),
            ).toBeVisible(),
        );
        await page
          .getByRole("link", { name: "Admin users", exact: true })
          .first()
          .click();
        await expect(
          page.getByRole("heading", { name: "Portal users", exact: true }),
        ).toBeVisible();
        await sample(
          "section-change",
          () =>
            page
              .getByRole("link", { name: "Roles & permissions", exact: true })
              .first()
              .click(),
          () =>
            expect(
              page.getByRole("heading", {
                name: "Roles & permissions",
                exact: true,
              }),
            ).toBeVisible(),
        );
        await sample(
          "role-open",
          () =>
            page
              .getByRole("link", { name: "View permissions", exact: true })
              .first()
              .click(),
          () => expect(page.locator('input[type="checkbox"]')).toHaveCount(28),
        );
        await page
          .getByRole("link", { name: "Admin users", exact: true })
          .first()
          .click();
        await expect(
          page.getByRole("heading", { name: "Portal users", exact: true }),
        ).toBeVisible();
      }
      await mkdir("tests/admin-navigation/results", { recursive: true });
      await writeFile(
        `tests/admin-navigation/results/${process.env.WHR_TIMING_PHASE ?? "before"}-${profile.name}.json`,
        JSON.stringify(
          {
            profile,
            source: process.env.WHR_TIMING_SOURCE ?? "6072636",
            browser: "local Linux Chromium",
            samples,
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      await f.db.end();
    }
  });
}
