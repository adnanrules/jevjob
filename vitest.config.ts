import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every test run gets a scratch data folder, so no test can ever touch the real job pool in .jevjob/.
    setupFiles: ["./vitest.setup.ts"],
  },
});
