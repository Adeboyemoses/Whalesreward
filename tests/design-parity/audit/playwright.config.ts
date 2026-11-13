import base from "../../../playwright.config";
const config = {
  ...base,
  testDir: ".",
  projects: [
    {
      name: "audit-fidelity",
      use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    ...base.webServer,
    cwd: new URL("../../../", import.meta.url).pathname,
  },
};

export default config;
