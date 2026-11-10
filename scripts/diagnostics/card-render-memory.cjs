/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS diagnostic preload/bundle runner. */
// Supply an absolute path to the bundled cards/renderer.ts module. Fictional snapshot only.
const { renderCardExport } = require(process.argv[2]);
(async () => {
  for (const n of [5, 1000])
    for (const format of ["pdf", "xlsx"]) {
      const start = performance.now();
      let peak = process.memoryUsage().rss;
      const timer = setInterval(
        () => (peak = Math.max(peak, process.memoryUsage().rss)),
        5,
      );
      timer.unref();
      const result = await renderCardExport(
        {
          id: "fictional",
          format,
          snapshotAt: new Date().toISOString(),
          batch: {
            id: "fixture",
            code: "BATCH001",
            name: "Fixture",
            status: "generated",
            version: 1,
          },
          items: Array.from({ length: n }, (_, i) => ({
            ordinal: i + 1,
            code: "ABCDEFG",
            qrPayload: "ABCDEFG",
            state: "unassigned",
            assignmentEligible: false,
          })),
        },
        {
          pageWidthMm: 210,
          pageHeightMm: 297,
          cardWidthMm: 85,
          cardHeightMm: 54,
          marginMm: 10,
          gapMm: 5,
        },
      );
      clearInterval(timer);
      console.log(
        JSON.stringify({
          n,
          format,
          ms: Math.round(performance.now() - start),
          rss: process.memoryUsage().rss,
          sampledPeakRss: Math.max(peak, process.memoryUsage().rss),
          heap: process.memoryUsage().heapUsed,
          bytes: result.bytes.length,
        }),
      );
    }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
