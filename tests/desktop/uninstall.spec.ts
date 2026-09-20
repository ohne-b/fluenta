import { test, expect } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { launchNative, stopNative } from "./native";

test.skip(
  process.platform !== "win32" || !!process.env.FLUENTA_STUDIO_TEST,
  "Windows learner build",
);

test("uninstall confirmation preserves data by default and cannot uninstall a QA profile", async ({}, info) => {
  const directory = mkdtempSync(resolve(".cache/uninstall-native-"));
  const { page, processHandle } = await launchNative(directory);
  try {
    await page
      .getByRole("button", { name: "Let’s begin", exact: true })
      .click();
    const guard = await page.evaluate(async () => {
      const internals = (window as any).__TAURI_INTERNALS__;
      const available = await internals.invoke("can_uninstall");
      const rejected = await internals
        .invoke("uninstall_app", { removeData: true })
        .then(
          () => false,
          () => true,
        );
      const native = window.fetch.bind(window);
      (window as any).__uninstallCalls = [];
      // Exercise the dialog without launching the user's real uninstaller.
      window.fetch = (input, init) => {
        const command = String(input);
        if (command.endsWith("/can_uninstall"))
          return Promise.resolve(
            new Response("true", {
              headers: {
                "Content-Type": "application/json",
                "Tauri-Response": "ok",
              },
            }),
          );
        if (command.endsWith("/uninstall_app")) {
          (window as any).__uninstallCalls.push(JSON.parse(String(init?.body)));
          return Promise.resolve(
            new Response(JSON.stringify("simulated launch failure"), {
              headers: {
                "Content-Type": "application/json",
                "Tauri-Response": "error",
              },
            }),
          );
        }
        return native(input, init);
      };
      return { available, rejected };
    });
    expect(guard).toEqual({ available: false, rejected: true });
    const logo = page.locator(".sidebar .brand-mark");
    const bounds = await logo.boundingBox();
    expect(bounds!.height / bounds!.width).toBeCloseTo(899 / 723, 1);
    await page.screenshot({
      path: info.outputPath("cropped-logo.png"),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Light", exact: true }).click();
    const open = page.getByRole("button", {
      name: "Uninstall Fluenta",
      exact: true,
    });
    await open.click();
    const dialog = page.getByRole("dialog", {
      name: "Uninstall Fluenta?",
      exact: true,
    });
    const remove = dialog.getByRole("checkbox", {
      name: /Also delete my learning data/,
    });
    await expect(remove).not.toBeChecked();
    await expect(dialog).toContainText("The AI model is always removed.");
    await page.screenshot({
      path: info.outputPath("uninstall-default.png"),
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await page.evaluate(() => (window as any).__uninstallCalls)).toEqual(
      [],
    );
    await open.click();
    await dialog
      .getByRole("button", { name: "Uninstall", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await remove.check();
    await page.screenshot({
      path: info.outputPath("uninstall-confirmation.png"),
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Uninstall", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__uninstallCalls))
      .toEqual([{ removeData: false }, { removeData: true }]);
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  } finally {
    await stopNative(processHandle);
  }
});
