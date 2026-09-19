import { test, expect, type Page } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  linkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { launchNative, stopNative } from "./native";

let processHandle: ChildProcess, page: Page, directory: string;
const root = resolve(".");
test.describe.configure({ mode: "serial" });
test.skip(
  process.platform !== "win32" || !!process.env.FLUENTA_STUDIO_TEST,
  "Requires the Windows learner build.",
);
async function launch() {
  ({ processHandle, page } = await launchNative(directory));
}
async function stop() {
  await stopNative(processHandle);
}

test.beforeAll(async () => {
  mkdirSync(join(root, ".cache"), { recursive: true });
  directory = mkdtempSync(join(root, ".cache/desktop-test-"));
  await launch();
});
test.afterAll(async () => {
  await stop();
});

test("complete an offline lesson, preserving a draft across an actual app restart", async ({}, info) => {
  await expect(
    page.getByRole("heading", { name: "Let’s begin" }),
  ).toBeVisible();
  expect(
    await page
      .locator(".brand-mark")
      .first()
      .evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("onboarding.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Your next step",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("learn.png"),
    fullPage: true,
    animations: "disabled",
  });
  await expect(page.locator("body")).toHaveCSS("font-family", /Manrope/);
  await expect(page.locator(".titlebar")).not.toContainText("Fluenta");
  await expect(page.locator(".titlebar")).toHaveCSS(
    "border-bottom-width",
    "0px",
  );
  await expect(page.locator(".sidebar .brand")).toHaveText("fluenta");
  const sidebar = await page.locator(".sidebar").boundingBox();
  const titlebar = await page.locator(".titlebar").boundingBox();
  const brand = await page.locator(".sidebar .brand").boundingBox();
  expect(sidebar!.y).toBe(0);
  expect(titlebar!.x).toBe(sidebar!.x + sidebar!.width);
  expect(brand!.y).toBeLessThan(30);
  const github = page.getByRole("link", { name: "GitHub", exact: true });
  await expect(github).toHaveAttribute(
    "href",
    "https://github.com/ohne-b/fluenta",
  );
  expect(
    await github.evaluate((link) => link.nextElementSibling?.textContent),
  ).toBe("Settings");
  await expect(page.getByText(/daily goal/i)).toHaveCount(0);
  await expect(page.locator(".topbar, .language-pill")).toHaveCount(0);
  const heading = await page
    .getByRole("heading", { name: "Your next step" })
    .boundingBox();
  const search = await page
    .getByRole("button", { name: "Search", exact: true })
    .boundingBox();
  expect(
    Math.abs(heading!.y + heading!.height / 2 - search!.y - search!.height / 2),
  ).toBeLessThan(2);
  await page
    .getByRole("button", { name: "Maximize window", exact: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: "Restore window", exact: true })
      .locator(".caption-glyph"),
  ).toHaveText("\uE923");
  await page
    .getByRole("button", { name: "Restore window", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Maximize window", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".window-controls .caption-glyph")).toHaveText([
    "\uE921",
    "\uE922",
    "\uE8BB",
  ]);
  await expect(page.locator(".caption-glyph").first()).toHaveCSS(
    "font-family",
    /Segoe Fluent Icons/,
  );
  await page
    .getByRole("link", { name: "All foundation lessons", exact: true })
    .click();
  await page.locator(".unit-heading").first().click();
  const courseCards = await page.locator(".unit-card").evaluateAll((cards) =>
    cards.map((card) => ({
      top: card.getBoundingClientRect().top,
      bottom: card.getBoundingClientRect().bottom,
    })),
  );
  expect(courseCards.length).toBeGreaterThan(1);
  for (let i = 1; i < courseCards.length; i++)
    expect(courseCards[i].top - courseCards[i - 1].bottom).toBe(12);
  await page.screenshot({
    path: info.outputPath("foundation-courses.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await page
    .getByRole("button", { name: "Start learning", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("radio", { name: /Somos estudiantes/ }).check();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Correct" })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const word of ["Mi", "amiga", "es", "de", "Madrid."])
    await page.getByRole("button", { name: word, exact: true }).click();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Your answer", exact: true })
    .fill("Somos estudiantes");
  await page.getByRole("button", { name: "Grammar help", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Grammar help" }),
  ).toContainText("Use ser for identity");
  await page.screenshot({
    path: info.outputPath("lesson-help.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your answer", exact: true }),
  ).toHaveValue("Somos estudiantes");
  await expect(
    page.getByText("Your draft is saved on this device.", { exact: true }),
  ).toHaveCount(0);
  const exited = once(processHandle, "exit");
  await page.getByRole("button", { name: "Close window", exact: true }).click();
  await exited;
  await launch();
  await page
    .getByRole("link", { name: "Resume your session", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your answer", exact: true }),
  ).toHaveValue("Somos estudiantes");
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Listen", exact: true }),
  ).toBeVisible();
  if (process.env.FLUENTA_TEST_AUDIO) {
    await page.getByRole("button", { name: "Listen", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Stop audio", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Listen", exact: true }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('.audio-control [role="alert"]')).toHaveCount(0);
  }
  await page.getByRole("radio", { name: /De Sevilla/ }).check();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Your answer", exact: true })
    .fill(
      "Me llamo Elena y tengo dieciséis años. Soy de Berlín. Estudio español e historia en el instituto.",
    );
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review your answer" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Use the guidance below to check your work. Longer answers are not automatically graded.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lesson complete" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("recap.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Back to learning", exact: true })
    .click();
});

test("reference search and immediate theme changes preserve separate language settings", async ({}, info) => {
  await page.getByRole("link", { name: "Grammar", exact: true }).click();
  await expect(page.locator(".grammar-row")).toHaveCount(17);
  await expect(page.locator(".grammar-band")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Grammar level" }),
  ).toHaveCount(0);
  await expect(page.locator(".grammar-row h3").first()).toHaveText(
    "ser / estar",
  );
  await expect(page.locator(".grammar-nested .grammar-row")).toHaveCount(3);
  const lists = await page.locator(".grammar-list").evaluateAll((elements) =>
    elements.map((element) => ({
      x: element.getBoundingClientRect().x,
      border: getComputedStyle(element).borderLeftWidth,
      radius: getComputedStyle(element).borderRadius,
    })),
  );
  for (const list of lists)
    expect(list).toEqual({ x: lists[0].x, border: "1px", radius: "4px" });
  await page
    .getByRole("textbox", { name: "Search grammar" })
    .fill("present endings");
  await expect(page.locator(".grammar-filters .search-input")).toHaveCSS(
    "border-radius",
    "4px",
  );
  await expect(page.getByRole("textbox", { name: "Search grammar" })).toHaveCSS(
    "outline-style",
    "none",
  );
  await expect(page.locator(".grammar-row")).toHaveCount(1);
  await page.locator(".grammar-row").click();
  await expect(
    page.getByRole("table", { name: "Present: regular verbs" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Exercises/ }).click();
  await expect(page.locator(".grammar-lessons .lesson-row")).toHaveCount(3);
  await expect(
    page.getByRole("button", {
      name: "Start lesson: Your school day",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Explanation", exact: true }).click();
  await page.screenshot({
    path: info.outputPath("grammar-course.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("link", { name: "All grammar", exact: true }).click();
  await page.getByRole("textbox", { name: "Search grammar" }).fill("");
  await page.screenshot({
    path: info.outputPath("grammar.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("textbox").fill("habláis");
  await page.locator(".reference-results button").first().click();
  const table = page.getByRole("table", { name: "Present: regular verbs" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(7);
  await expect(
    table.getByRole("cell", { name: "vivimos", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("grammar-table.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("textbox").fill("ser");
  await expect(page.locator(".reference-results button").first()).toBeVisible();
  await page.locator(".reference-results button").first().click();
  await page.getByRole("button", { name: "Bookmark", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: /Learning language/ })
    .selectOption("de");
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: /App language/ })
    .selectOption("de");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator(".modal-overlay")).toHaveCSS("top", "0px");
  expect(
    await page.locator(".titlebar").evaluate((bar) => {
      const rect = bar.getBoundingClientRect();
      return document
        .elementFromPoint(rect.x + 10, rect.y + 10)
        ?.classList.contains("modal-overlay");
    }),
  ).toBe(true);
  await expect(page.getByRole("combobox", { name: "Daily goal" })).toHaveCount(
    0,
  );
  await expect(page.locator(".download-item")).toHaveCount(0);
  await expect(page.getByRole("dialog")).not.toContainText(
    "Experimental tutor",
  );
  await expect(page.getByRole("dialog")).not.toContainText("On your device");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  for (const name of [/Learning language/, /App language/])
    await expect(page.getByRole("combobox", { name })).toHaveValue("de");
  await page.screenshot({
    path: info.outputPath("settings-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.locator(".modal-body").evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  await page.screenshot({
    path: info.outputPath("settings-downloads.png"),
    fullPage: true,
  });

  // Only the theme is saved immediately; pending language edits stay separate.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await stop();
  await launch();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  for (const name of [/Learning language/, /App language/]) {
    await expect(page.getByRole("combobox", { name })).toHaveValue("en");
    await page.getByRole("combobox", { name }).selectOption("de");
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Einstellungen", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: info.outputPath("german-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Suchen", exact: true }).click();
  await page.getByRole("textbox").fill("habláis");
  await page.locator(".reference-results button").first().click();
  await expect(
    page.getByRole("table", { name: "Präsens: regelmäßige Verben" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("grammar-table-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await page.setViewportSize({ width: 600, height: 760 });
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  await page.screenshot({
    path: info.outputPath("compact.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1180, height: 820 });
});

test("grammar starts with guided choices and links to longer contextual practice", async ({}, info) => {
  await page.getByRole("link", { name: "Grammatik", exact: true }).click();
  await page
    .locator(".grammar-row")
    .filter({
      has: page.getByRole("heading", { name: "ser / estar", exact: true }),
    })
    .click();
  await page.getByRole("button", { name: /^Übungen/ }).click();
  await expect(page.locator(".grammar-lessons .lesson-row")).toHaveCount(3);
  await page.locator(".grammar-lessons .lesson-row").first().click();
  const answers = [
    "Ana es estudiante.",
    "El profesor está en la biblioteca.",
    "La clase es aburrida.",
    "El concierto es en el patio.",
    "soy",
    "estás",
    "somos",
    "están",
  ];
  for (const [index, answer] of answers.entries()) {
    await page
      .getByRole("radio", {
        name: new RegExp(answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
      })
      .check();
    if (index === 0)
      await page.screenshot({
        path: info.outputPath("grammar-choice.png"),
        fullPage: true,
        animations: "disabled",
      });
    await page
      .getByRole("button", { name: "Antwort prüfen", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Richtig", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
  }
  for (const answer of ["está", "sois"]) {
    await page
      .getByRole("textbox", { name: "Deine Antwort", exact: true })
      .fill(answer);
    await page
      .getByRole("button", { name: "Antwort prüfen", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Richtig", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Zurück zum Lernen", exact: true })
    .click();
  await page.getByRole("link", { name: "Grammatik", exact: true }).click();
  await page
    .locator(".grammar-row")
    .filter({
      has: page.getByRole("heading", { name: "ser / estar", exact: true }),
    })
    .click();
  await page.getByRole("button", { name: /^Übungen/ }).click();
  await expect(
    page.locator(".grammar-lessons .lesson-row").first(),
  ).toHaveClass(/complete/);
  await page.locator(".grammar-lessons .lesson-row").nth(1).click();
  await expect(page.locator(".material")).toContainText(
    "El examen es en el aula 4",
  );
  await expect(page.getByRole("radio")).toHaveCount(3);
  await page.screenshot({
    path: info.outputPath("grammar-reading.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await page
    .getByRole("button", { name: "Speichern und verlassen", exact: true })
    .click();
});

test("checkpoint policy is enforced in Rust and the optional tutor is absent", async () => {
  await page.getByRole("link", { name: "Tutor", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Tutor herunterladen",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Üben", exact: true }).click();
  await page.locator(".checkpoint-row").first().click();
  await page.getByRole("button", { name: "Test starten", exact: true }).click();
  await expect(page.locator(".timer")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Grammatikhilfe", exact: true }),
  ).toBeDisabled();
  const denied = await page.evaluate(async () => {
    // The test intentionally asks Rust directly, bypassing the hidden navigation.
    const native = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args: unknown) => Promise<any>;
        };
      }
    ).__TAURI_INTERNALS__;
    for (const command of [
      {
        command: "search_content",
        payload: { query: "ser", source_language: "de", cursor: null },
      },
      { command: "list_grammar", payload: { source_language: "de" } },
      {
        command: "get_grammar_help",
        payload: {
          context: {
            session_id: "test",
            step_id: "test",
            expected_step_version: 1,
          },
        },
      },
    ]) {
      const response = await native.invoke("dispatch", {
        request: {
          protocol_version: 1,
          request_id: crypto.randomUUID(),
          command,
        },
      });
      if (
        response.result.status !== "error" ||
        response.result.payload.message_key !== "test.finish_first"
      )
        return false;
    }
    return true;
  });
  expect(denied).toBe(true);
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await page.getByRole("button", { name: "Test beenden", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Dein nächster Schritt",
    }),
  ).toBeVisible();
});

test("optional native tutor replies, cancels and preserves its conversation after restart", async ({}, info) => {
  test.skip(
    !process.env.FLUENTA_TUTOR_TEST,
    "Set FLUENTA_TUTOR_TEST to an already verified model file. No test downloads weights.",
  );
  test.setTimeout(300_000);
  await stop();
  const model = JSON.parse(
    readFileSync(join(root, "crates/tutor/model.json"), "utf8"),
  );
  mkdirSync(join(directory, "models"), { recursive: true });
  linkSync(
    resolve(process.env.FLUENTA_TUTOR_TEST!),
    join(directory, "models", model.filename),
  );
  writeFileSync(join(directory, "models/verified.sha256"), model.sha256);
  await launch();
  await page.getByRole("link", { name: "Tutor", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Schreibe deinem Tutor …" })
    .fill("Hola");
  await page
    .getByRole("button", { name: "Nachricht senden", exact: true })
    .click();
  await expect(page.locator(".thinking > svg")).toBeVisible();
  await expect(page.locator(".thinking > p")).toHaveCount(0);
  await expect(page.locator(".chat-turn.assistant")).toHaveCount(1, {
    timeout: 120_000,
  });
  await expect(page.locator('.chat [role="alert"]')).toHaveCount(0);
  await page
    .getByRole("button", { name: "Neues Gespräch", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Tutor", exact: true })
    .selectOption("explain");
  await page
    .getByRole("textbox", { name: "Schreibe deinem Tutor …" })
    .fill("Ist «Me gustan los idiomas» korrekt? Erkläre kurz auf Deutsch.");
  await page
    .getByRole("button", { name: "Nachricht senden", exact: true })
    .click();
  await expect(page.locator(".chat-turn.assistant")).toHaveCount(1, {
    timeout: 120_000,
  });
  const response = await page
    .locator(".chat-turn.assistant .turn-body")
    .innerText();
  expect(response.length).toBeGreaterThan(30);
  await expect(page.locator(".native-explanation")).toHaveAttribute(
    "lang",
    "de",
  );
  await page
    .getByRole("textbox", { name: "Schreibe deinem Tutor …" })
    .fill(
      "Explícame la diferencia entre el indefinido y el imperfecto con un ejemplo escolar.",
    );
  await page
    .getByRole("button", { name: "Nachricht senden", exact: true })
    .click();
  await expect(page.locator(".chat-turn.assistant")).toHaveCount(2, {
    timeout: 120_000,
  });
  await expect(page.locator(".native-explanation").last()).toContainText(
    /Vergangenheit|Gewohnheit|abgeschlossen|Hintergrund|beschreibt/,
  );
  await expect(
    page
      .locator(".chat-turn.assistant")
      .last()
      .locator(".turn-references button")
      .first(),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("tutor.png"),
    fullPage: true,
    animations: "disabled",
  });
  // Keep the real worker, but delay its start acknowledgement so Stop can arrive first.
  await page.evaluate(() => {
    const native = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: { request?: { command?: { command?: string } } },
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = native.invoke.bind(native);
    native.invoke = async (command, args) => {
      const response = await invoke(command, args);
      if (args?.request?.command?.command === "start_tutor_turn") {
        native.invoke = invoke;
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      return response;
    };
  });
  await page
    .getByRole("textbox", { name: "Schreibe deinem Tutor …" })
    .fill("Erkläre jetzt die Vergangenheitsformen.");
  await page
    .getByRole("button", { name: "Nachricht senden", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Antwort stoppen", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Nachricht senden", exact: true }),
  ).toBeVisible();
  await stop();
  await launch();
  await page.getByRole("link", { name: "Tutor", exact: true }).click();
  await page.locator(".thread-list button").first().click();
  await expect(
    page.locator(".chat-turn.assistant .turn-body").first(),
  ).toHaveText(response, { useInnerText: true });
  await expect(page.locator(".chat-turn.assistant")).toHaveCount(2);
  for (const [label, mode] of [
    ["Über die Schule sprechen", "conversation"],
    ["Vergangenheitszeiten erklären", "explain"],
    ["Eine Argumentation aufbauen", "explain"],
  ]) {
    await page
      .getByRole("button", { name: "Neues Gespräch", exact: true })
      .click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Tutor", exact: true }),
    ).toHaveValue(mode);
    await page
      .getByRole("button", { name: "Nachricht senden", exact: true })
      .click();
    await expect(page.locator(".chat-turn.assistant")).toHaveCount(1, {
      timeout: 120_000,
    });
    if (mode === "explain") {
      await expect(page.locator(".native-explanation")).toBeVisible();
      await expect(page.locator(".native-explanation")).toHaveAttribute(
        "lang",
        "de",
      );
      await expect(page.locator(".native-explanation")).toContainText(
        label === "Vergangenheitszeiten erklären"
          ? /Vergangenheit|Gewohnheit|abgeschlossen|Hintergrund/
          : /Argumentation|These|Begründung|Beispiel/,
      );
    }
  }
});
