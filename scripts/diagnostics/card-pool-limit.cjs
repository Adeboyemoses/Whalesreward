/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS diagnostic preload/bundle runner. */
const Module = require("module");
const original = Module._load;
Module._load = function (id, ...args) {
  const result = original.call(this, id, ...args);
  if (result?.Pool && result?.Client && result?.defaults && !result.__whr97) {
    const Pool = result.Pool;
    result.Pool = class extends Pool {
      constructor(options) {
        super({ ...options, max: 2 });
        console.log(
          JSON.stringify({ probe: "pool-limit", max: this.options.max }),
        );
        setInterval(
          () =>
            console.log(
              JSON.stringify({
                probe: "pool",
                max: this.options.max,
                total: this.totalCount,
                idle: this.idleCount,
                waiting: this.waitingCount,
              }),
            ),
          1000,
        ).unref();
      }
    };
    result.__whr97 = true;
  }
  return result;
};
