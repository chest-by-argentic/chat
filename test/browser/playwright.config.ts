import { defineConfig } from "@playwright/test";

// The browser test: Chat on the local Chest of the tests (test/lab), two
// members live at once, desktop and phone, light and dark, English and
// French, axe on every screen. npm run test:browser (after npm test's
// builds).
export default defineConfig({
  testDir: ".",
  globalSetup: "./setup.ts",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: { browserName: "chromium", locale: "en-US", timezoneId: "Europe/Paris", viewport: { width: 1440, height: 900 } },
});
