setInterval(
  () =>
    console.log(
      JSON.stringify({
        probe: "memory",
        rss: process.memoryUsage().rss,
        heap: process.memoryUsage().heapUsed,
      }),
    ),
  1000,
).unref();
