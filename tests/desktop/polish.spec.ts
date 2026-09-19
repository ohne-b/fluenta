import { test, expect } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { launchNative, stopNative } from "./native";

test.skip(
  process.platform !== "win32" || !!process.env.FLUENTA_STUDIO_TEST,
  "Windows learner build",
);

test("course selection, independent sections and compact keyboard navigation", async ({}, info) => {
  const directory = mkdtempSync(resolve(".cache/polish-native-"));
  const { page, processHandle } = await launchNative(directory);
  try {
    await page
      .getByRole("button", { name: "Let’s begin", exact: true })
      .click();
    await page
      .getByRole("link", { name: "All foundation lessons", exact: true })
      .click();
    const sections = page.locator(".unit-heading");
    await expect(sections.first()).toHaveAttribute("aria-expanded", "true");
    await expect(sections.nth(1)).toHaveAttribute("aria-expanded", "false");
    await sections.nth(1).click();
    await expect(sections.first()).toHaveAttribute("aria-expanded", "true");
    await expect(sections.nth(1)).toHaveAttribute("aria-expanded", "true");
    await sections.first().click();
    await expect(sections.nth(1)).toHaveAttribute("aria-expanded", "true");
    for (const band of ["A2", "B1", "B2"]) {
      await page
        .getByRole("combobox", { name: "Your starting point" })
        .selectOption(band);
      const next = page.locator(".lesson-row.next .lesson-details strong");
      await expect(next).toHaveCount(1);
      await expect(page.locator(".hero-copy h2")).toHaveText(
        (await next.textContent())!,
      );
      await expect(page.locator(".hero-copy p")).toContainText(band);
    }
    await page.getByRole("link", { name: "Grammar", exact: true }).click();
    await expect(page.locator(".grammar-row")).toHaveCount(17);
    const viewport = page.locator(".desktop-viewport");
    await viewport.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    await page.getByRole("link", { name: "Topics", exact: true }).click();
    await expect(page.locator(".topic-card")).toHaveCount(8);
    await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBe(0);
    await page
      .getByRole("link", { name: "Skip to content", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/topics$/);
    await expect(page.locator("#main-content")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Search", exact: true }),
    ).toBeFocused();
    const interest = page.locator(".theme-spain-memory button[aria-pressed]");
    await interest.click();
    await expect(interest).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("link", { name: "Today", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(
      page.getByRole("dialog", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Your starting point" })
      .selectOption("A2");
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".daily-mission h2")).toHaveText("Llegar");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Your starting point" })
      .selectOption("B2");
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".daily-mission h2")).toHaveText(
      "Una plaza, varias memorias",
    );
    for (const theme of ["Light", "Dark"]) {
      await page.setViewportSize({ width: 600, height: 500 });
      for (const name of [
        "Today",
        "Topics",
        "My words",
        "Practice",
        "Grammar",
        "Tutor",
        "GitHub",
      ])
        await expect(
          page.getByRole("link", { name, exact: true }),
        ).toBeInViewport();
      const settings = page.getByRole("button", {
        name: "Settings",
        exact: true,
      });
      await expect(settings).toBeInViewport();
      await settings.click();
      await page.getByRole("button", { name: theme, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        theme.toLowerCase(),
      );
      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: "Tutor", exact: true }).click();
      await expect(page).toHaveURL(/#\/tutor/);
      await page.getByRole("link", { name: "Today", exact: true }).click();
      expect(
        await viewport.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: info.outputPath(`compact-${theme.toLowerCase()}.png`),
      });
    }
  } finally {
    await stopNative(processHandle);
  }
});
