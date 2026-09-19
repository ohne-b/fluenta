import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { once } from "node:events";
import type { ChildProcess } from "node:child_process";
import type {
  Command,
  Response,
  Success,
} from "../../packages/contracts/src/index";
import { launchNative, stopNative } from "./native";

let page: Page, processHandle: ChildProcess, directory: string;
test.describe.configure({ mode: "serial" });
test.skip(
  process.platform !== "win32" || !!process.env.FLUENTA_STUDIO_TEST,
  "Windows learner build",
);
async function dispatch(command: Command): Promise<Response> {
  return page.evaluate(async (command) => {
    const native = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (name: string, args: unknown) => Promise<Response>;
        };
      }
    ).__TAURI_INTERNALS__;
    return native.invoke("dispatch", {
      request: {
        protocol_version: 1,
        request_id: crypto.randomUUID(),
        command,
      },
    });
  }, command);
}
async function connected(
  payload: Extract<Command, { command: "connected" }>["payload"],
) {
  const response = await dispatch({ command: "connected", payload });
  if (response.result.status !== "ok")
    throw new Error(response.result.payload.message_key);
  return response.result.payload as Extract<Success, { kind: "connected" }>;
}
async function launch() {
  ({ page, processHandle } = await launchNative(directory));
}
test.beforeAll(async () => {
  mkdirSync(resolve(".cache"), { recursive: true });
  directory = mkdtempSync(join(resolve(".cache"), "connected-native-"));
  await launch();
});
test.afterAll(async () => {
  await stopNative(processHandle);
});

test("mission vocabulary, keyboard lookup, draft restart, self-review and revision use native storage", async ({}, info) => {
  test.setTimeout(180_000);
  await page.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your next step" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("today.png"), fullPage: true });
  await page.getByRole("link", { name: "Topics", exact: true }).click();
  await expect(page.locator(".topic-card")).toHaveCount(8);
  await page.screenshot({
    path: info.outputPath("topics.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: /Migration and belonging/ }).click();
  await expect(page.locator(".mission-card")).toHaveCount(6);
  await page
    .locator(".mission-card")
    .first()
    .getByRole("button", { name: "Start mission", exact: true })
    .click();
  const term = page
    .locator(".teaching-word")
    .filter({ hasText: "llegar a" })
    .first();
  await term.hover();
  await expect(page.getByRole("tooltip")).toContainText("arrive");
  const recent = await connected({ action: "words" });
  expect(recent.data.kind).toBe("words");
  if (recent.data.kind === "words") expect(recent.data.data).toHaveLength(0);
  await term.focus();
  await term.press("Enter");
  const popover = page.getByRole("dialog", { name: "Word lookup" });
  await expect(popover).toBeVisible();
  await expect(
    popover.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await expect(
    popover.getByRole("button", { name: "Close", exact: true }),
  ).toHaveCSS("outline-style", "solid");
  await popover
    .getByRole("button", { name: "Learn this", exact: true })
    .click();
  await expect(
    popover.getByRole("button", { name: "Learning", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("reading-word.png"),
    fullPage: true,
  });
  if (process.env.FLUENTA_TEST_AUDIO) {
    await popover
      .getByRole("button", { name: "Listen · synthetic voice", exact: true })
      .click();
    await expect(
      popover.getByRole("button", { name: "Stop audio", exact: true }),
    ).toBeVisible();
    await expect(
      popover.getByRole("button", {
        name: "Listen · synthetic voice",
        exact: true,
      }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(popover.getByRole("alert")).toHaveCount(0);
  }
  await popover.press("Escape");
  await expect(popover).not.toBeVisible();
  await page
    .getByRole("button", { name: "Keep an argument", exact: true })
    .click();
  await page
    .getByRole("textbox", {
      name: "Your argument · grounded in this source",
      exact: true,
    })
    .fill("Lucía needs access to the timetable, not someone to speak for her.");
  await page
    .getByRole("textbox", {
      name: "Switch sides: a reasonable counterargument",
      exact: true,
    })
    .fill("A guide alone may not help someone join an activity.");
  await page
    .getByRole("button", { name: "Save to notebook", exact: true })
    .click();
  await expect(page.locator(".argument-editor")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("radio", { name: /Las normas y los horarios/ }).check();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const answer of ["llegar a", "el barrio"]) {
    await page
      .getByRole("textbox", { name: "Your answer", exact: true })
      .fill(answer);
    await page
      .getByRole("button", { name: "Check answer", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Correct", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await page.getByRole("radio", { name: /welcome, reception/ }).check();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const original =
    "Lucía necesita conocer los horarios y las reglas del instituto. Una compañera puede enseñarle dónde encontrar la información y preguntarle qué actividades le gustan. El texto explica que quiere jugar al baloncesto. Propongo invitarla a un partido y preparar juntos una guía breve. Así puede participar sin depender siempre de otras personas y también compartir sus propios intereses con la clase.";
  await page
    .getByRole("textbox", { name: "Your answer", exact: true })
    .fill(original);
  await page.getByRole("button", { name: "Grammar help", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Grammar help" }),
  ).toContainText("ser");
  await page
    .getByRole("dialog", { name: "Grammar help" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your answer", exact: true }),
  ).toHaveValue(original);
  const exited = once(processHandle, "exit");
  await page.getByRole("button", { name: "Close window", exact: true }).click();
  await exited;
  await launch();
  await page
    .getByRole("link", { name: "Resume your session", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your answer", exact: true }),
  ).toHaveValue(original);
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lesson complete", exact: true }),
  ).toBeVisible();
  await page.locator(".production-record > summary").click();
  const revision =
    original +
    " La ayuda debe responder a una necesidad concreta, no suponer que Lucía no sabe hacer nada.";
  await page.getByRole("textbox", { name: "Revised response" }).fill(revision);
  await page
    .getByRole("button", { name: "Save revision", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Revision saved", exact: true }),
  ).toBeVisible();
  const work = await connected({ action: "productions" });
  expect(work.data.kind).toBe("productions");
  if (work.data.kind === "productions") {
    expect(work.data.data[0].original).toEqual({
      kind: "writing",
      text: original,
    });
    expect(work.data.data[0].revisions[0].answer).toEqual({
      kind: "writing",
      text: revision,
    });
  }
  await page.screenshot({
    path: info.outputPath("mission-recap.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Back to learning", exact: true })
    .click();
  await page.getByRole("link", { name: "My words", exact: true }).click();
  await expect(page.locator(".word-card")).toHaveCount(1);
  const wordSearch = page.getByRole("textbox", {
    name: "Search words and notes",
  });
  await wordSearch.fill("  LLEGAR A  ");
  await expect(page.locator(".word-card")).toHaveCount(1);
  await wordSearch.fill("zzzz no matching expression");
  await expect(
    page.getByRole("heading", { name: "No matching expressions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Explore topics", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(wordSearch).toHaveValue("");
  await expect(page.locator(".word-card")).toHaveCount(1);
  await page.locator(".word-card details > summary").click();
  await page
    .getByRole("textbox", { name: "Your notes" })
    .fill("Remember the preposition a before a place.");
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  await page.locator(".word-card details > summary").click();
  await page
    .getByRole("heading", { name: "Your vocabulary", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("my-words.png"),
    fullPage: true,
  });
  await stopNative(processHandle);
  await launch();
  await page.getByRole("link", { name: "My words", exact: true }).click();
  await page.locator(".word-card details > summary").click();
  await expect(page.getByRole("textbox", { name: "Your notes" })).toHaveValue(
    "Remember the preposition a before a place.",
  );
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Argument", exact: true }),
  ).toHaveValue(
    "Lucía needs access to the timetable, not someone to speak for her.",
  );
  await expect(
    page.getByRole("textbox", { name: "Counterargument", exact: true }),
  ).toHaveValue("A guide alone may not help someone join an activity.");
  await page.screenshot({
    path: info.outputPath("notebook.png"),
    fullPage: true,
  });
});

test("rehearsal restrictions, held-out material, visual source and smaller windows", async ({}, info) => {
  await page.getByRole("link", { name: "Topics", exact: true }).click();
  await page.getByRole("link", { name: /Migration and belonging/ }).click();
  const first = page.locator(".mission-card").first();
  await first.locator(".mission-options > summary").click();
  await first
    .getByRole("combobox", { name: "Support level" })
    .selectOption("rehearsal");
  await first
    .getByRole("button", { name: "Open challenge", exact: true })
    .click();
  await expect(page.locator(".timer")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Grammar help", exact: true }),
  ).toBeDisabled();
  for (const command of [
    { command: "open_source", payload: { url: "https://www.isb.bayern.de/" } },
    { command: "connected", payload: { action: "words" } },
    {
      command: "get_reference",
      payload: {
        content: { id: "mission.migration.1.unseen.rubric.model", revision: 1 },
        source_language: "en",
      },
    },
  ] as Command[]) {
    const response = await dispatch(command);
    expect(response.result.status).toBe("error");
  }
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "End checkpoint", exact: true })
    .click();
  await page.getByRole("link", { name: "Topics", exact: true }).click();
  await page
    .getByRole("link", { name: /Economy, environment and sustainability/ })
    .click();
  await page
    .getByRole("button", { name: "Start mission", exact: true })
    .click();
  await expect(page.locator(".mission-image img")).toBeVisible();
  expect(
    await page
      .locator(".mission-image img")
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBe(600);
  await page.setViewportSize({ width: 620, height: 740 });
  await page.locator(".mission-image").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("visual-source-small.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Save and leave", exact: true })
    .click();
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.getByRole("link", { name: "Practice", exact: true }).click();
  await page
    .getByRole("button", { name: "General Abitur", exact: true })
    .click();
  await expect(page.getByText(/Advanced reference: Bayern/)).toBeVisible();
  await page.screenshot({
    path: info.outputPath("abitur.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  for (const name of [/Learning language/, /App language/])
    await page.getByRole("combobox", { name }).selectOption("de");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await page.getByRole("link", { name: "Themen", exact: true }).click();
  await expect(page.locator(".topic-card")).toHaveCount(8);
  await expect(page.locator(".topic-card h2").first()).toHaveText(
    "Migration und Zugehörigkeit",
  );
  await page.screenshot({
    path: info.outputPath("topics-german-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 620, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: /Migration und Zugehörigkeit/ }).click();
  await page
    .locator(".mission-card")
    .first()
    .getByRole("button", { name: "Mission starten", exact: true })
    .click();
  const term = page
    .locator(".teaching-word")
    .filter({ hasText: "llegar a" })
    .first();
  await term.focus();
  await term.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Wort nachschlagen" }),
  ).toContainText("ankommen");
  await page.screenshot({
    path: info.outputPath("word-german-dark-small.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
