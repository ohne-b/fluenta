import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/desktop",
  outputDir: "./.cache/test-results",
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: ".cache/playwright-report" }],
  ],
  webServer: process.env.FLUENTA_TEST_EXE
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:1420",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
