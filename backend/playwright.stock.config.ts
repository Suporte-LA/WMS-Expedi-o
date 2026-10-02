import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./stock-e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: process.env.STOCK_E2E_URL || "http://127.0.0.1:5181",
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
