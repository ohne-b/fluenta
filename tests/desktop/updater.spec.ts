import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchNative, stopNative } from "./native";

test.skip(
  !process.env.FLUENTA_UPDATE_TEST_SIGNATURE ||
    !!process.env.FLUENTA_STUDIO_TEST,
  "Use an isolated QA build with the updater endpoint http://127.0.0.1:19555/latest.json and a signed harmless test file.",
);

test("signed update rejects modified bytes and keeps the app and saved settings usable", async () => {
  let downloads = 0;
  const server = createServer((request, response) => {
    if (request.url === "/latest.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          version: "99.0.0",
          notes: "Signature verification test",
          platforms: {
            "windows-x86_64": {
              url: "http://127.0.0.1:19555/modified.exe",
              signature: readFileSync(
                process.env.FLUENTA_UPDATE_TEST_SIGNATURE!,
                "utf8",
              ).trim(),
            },
          },
        }),
      );
    } else {
      downloads++;
      response.end("Modified test data. This is not an executable.");
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(19555, "127.0.0.1", resolve),
  );
  let child;
  try {
    const native = await launchNative(
      mkdtempSync(resolve(".cache/updater-test-")),
    );
    child = native.processHandle;
    const page = native.page;
    await page
      .getByRole("button", { name: "Let’s begin", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Settings", exact: true })
      .first()
      .click();
    await page
      .getByRole("combobox", { name: "Your starting point" })
      .selectOption("B1");
    await page
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await expect(page.getByText("Available update · 99.0.0")).toBeVisible();
    const failures: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(message.text());
    });
    await page
      .getByRole("button", { name: "Download and install", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "The update could not be completed.",
    );
    expect(downloads).toBe(1);
    expect(failures.join("\n")).toMatch(/signature/i);
    expect(child.exitCode).toBeNull();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Settings", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("combobox", { name: "Your starting point" }),
    ).toHaveValue("B1");
  } finally {
    await stopNative(child);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
