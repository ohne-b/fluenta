import { test, expect, type Page } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchNative, stopNative } from "./native";

test.skip(
  process.platform !== "win32" || !process.env.FLUENTA_STUDIO_TEST,
  "Build Studio and set FLUENTA_STUDIO_TEST=1.",
);
let child: ChildProcess, page: Page, source: string;
test.beforeAll(async () => {
  mkdirSync(".cache", { recursive: true });
  const directory = mkdtempSync(resolve(".cache/studio-test-"));
  source = join(directory, "curriculum");
  cpSync(resolve("content/foundation"), source, { recursive: true });
  ({ processHandle: child, page } = await launchNative(directory, [
    "--curriculum",
    source,
  ]));
});
test.afterAll(async () => {
  await stopNative(child);
});

test("edit a real translation, compile both languages and preview native grading", async ({}, info) => {
  await expect(
    page.getByRole("heading", { name: "Curriculum editor" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "locales/en.json", exact: true })
    .click();
  const filter = page.getByRole("textbox", { name: "Find a translation slot" });
  const slot = Object.keys(
    JSON.parse(readFileSync(join(source, "locales/en.json"), "utf8")),
  )[0];
  await filter.fill(slot);
  const field = page.locator(".translation-fields textarea").first();
  const key = await page
    .locator(".translation-fields code")
    .first()
    .innerText();
  const updated = `${await field.inputValue()} (Studio check)`;
  await field.fill(updated);
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Save your open Studio file before installing an update."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  expect(
    JSON.parse(readFileSync(join(source, "locales/en.json"), "utf8"))[key],
  ).toBe(updated);
  await page
    .getByRole("button", { name: "Validate & preview", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "8 course packs compiled.",
  );
  await page.screenshot({
    path: info.outputPath("studio.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page
    .locator(".studio-preview-grid button")
    .filter({ hasText: "Who we are" })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("radio", { name: /Somos estudiantes/ }).check();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Correct" })).toBeVisible();
});
