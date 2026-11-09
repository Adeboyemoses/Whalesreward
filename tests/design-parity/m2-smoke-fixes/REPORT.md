# WHR-92 independent phone fidelity check

Checked product source through `ae154eb`, integrated tree `1539844b124c796a0553d858f2e759148684cbfe`. The checker wrote no production code. Read the M2 smoke brief and accepted registration/pump-change briefs; inspected original A24, A06 and A17 PNG/HTML alongside all seven built captures.

**Result: 2 passed, 0 failed, 0 skipped, zero retries (7.2 seconds).** Seven PNGs and seven metric files at 390 CSS pixels, viewport height 844, device scale factor 2. Every capture measures document/root width 390 with no visible interactive target below 48 pixels. The focused invalid-card field has a solid 2-pixel whale-blue outline. IBM Plex Sans, existing notice components and existing design-system colours are retained; persistent warnings measure the expected `rgb(253, 240, 204)` background and 358-pixel content width.

| Board/state | Match | Differences | Severity |
|---|---|---|---|
| [A24 unknown card](screenshots/A24-SaleCustomerNotFound-390.built.png) | Yes, scope and hierarchy | Red lookup error, blue information notice, distinct Register this customer action and disabled Save remain. Fictional candidate code differs from board; existing generic error does not repeat the code. | note |
| [A24 invalid format](screenshots/A24-InvalidCardFormat-390.built.png) | Approved added state | Exact format message ends with a full stop. No unregistered-card notice or registration action; visible input focus ring. | note |
| [A06 prefilled candidate](screenshots/A06-RegisterPrefilled-390.built.png) | Yes | Typed candidate reaches the existing card field; name/category/phone layout matches A06. Fixture phone is unformatted; this test does not submit an unknown card or claim it is eligible. | note |
| [A17 Account](screenshots/A17-PumpChange-390.built.png) | Yes, with retained differences | One yellow warning names Pump 04/Kerosene; current Pump 02/PMS identity, new assignment, two pending original-pump sales and explicit sign-out action remain. Brief-approved wording says “before using the new pump” and “Pending sales keep their original details”. | note |
| [A17 Sale warning](screenshots/A17-SaleWarning-390.built.png) | Approved extension | One warning appears above Customer; no interruption, modal or automatic navigation. Existing sale form/CTA stay in place below it. | note |
| [A17 Register warning](screenshots/A17-RegisterWarning-390.built.png) | Approved extension | Same warning above the existing registration fields; no duplicated warning. | note |
| [A17 Uploads warning](screenshots/A17-UploadsWarning-390.built.png) | Approved extension | Assignment warning is distinct from the existing zero-credit upload warning. Two pending sales and the original amounts remain visible in the queue presentation. | note |

No new blocking visual drift was identified. Retained differences already documented by the accepted customers/cards report: four implemented navigation tabs (History is not fabricated), `Pump PUMP02` formatting tracked by WHR-81, existing navigation icons, and fixed action/navigation bars appearing within tall full-page captures. The latter records their real 844-pixel viewport placement; it is not a static-board footer-position comparison. Fictional generated usernames/staff IDs replace static board identities. The addition has no dedicated cross-screen board, so A17's existing warning tokens and the approved brief govern its placement.

The pending-two fixture uses the existing real UI capture and atomic IndexedDB save path with a live fictional canvas camera. A local 503 transport refusal keeps uploads pending; no successful server acceptance or credit response is substituted. The configured reassignment is created through the actual authorized local admin API. Functional race, authority, account-partition and fresh-sign-in clearing assertions belong to the separate regression suite and EM final gates; these captures do not claim credit-path acceptance.

## Reproduction

The checker ran `pnpm typecheck` and `pnpm build` successfully at `1539844`, then reused that production artifact for captures. Local Postgres and MinIO are the existing Compose services; the isolated fictional database is prepared by the checked-in customers/cards setup.

On a host that can launch Chromium directly:

```sh
DATABASE_URL=postgresql://whr:whr@127.0.0.1:5433/whr_app6_m2_parity pnpm exec playwright test --config tests/design-parity/m2-smoke-fixes/playwright.config.ts
```

For the sandboxed macOS host, an existing local Linux image/dependency volume supplies only the browser. This browser-server command exposes only loopback and proxies its own localhost to the host's local test app:

```sh
docker run -d --rm --name whr-s02-browser -p 127.0.0.1:9223:9223 -v whr-upload-node-modules:/deps:ro whr-upload-browser:lean node -e 'const net=require("node:net");net.createServer(s=>{const t=net.connect(3000,"host.docker.internal");s.pipe(t);t.pipe(s);s.on("error",()=>t.destroy());t.on("error",()=>s.destroy())}).listen(3000,"127.0.0.1");require("/deps/@playwright/test").chromium.launchServer({host:"0.0.0.0",port:9223,args:["--no-sandbox"]}).then(b=>console.log(b.wsEndpoint()))'
```

Use the emitted WebSocket endpoint with its host replaced by `127.0.0.1`; `WHR_TEST_BROWSER_WS` connects the host test runner to that browser. After a successful production build:

```sh
DATABASE_URL=postgresql://whr:whr@127.0.0.1:5433/whr_app6_m2_parity WHR_USE_BUILT_APP=1 WHR_TEST_BROWSER_WS=ws://127.0.0.1:9223/<emitted-path> pnpm exec playwright test --config tests/design-parity/m2-smoke-fixes/playwright.config.ts
```

The first capture run had one checker failure: an exact “Uploads” accessible-name locator ignored the genuine “2 pending uploads” badge. Selecting the known route inside Main navigation corrected that locator; no assertion, timeout or retry count was relaxed. Earlier producer TypeScript errors (tuple inference and inherited web-server union) were corrected before the successful typecheck/build. No production source changed during either correction.
