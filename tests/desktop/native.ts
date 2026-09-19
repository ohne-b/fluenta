import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { once } from "node:events";

export async function launchNative(directory: string, args: string[] = []) {
  const root = resolve(".");
  // Match an Explorer launch: test runners set NO_COLOR and hide CLI ANSI bugs.
  const environment = { ...process.env };
  for (const key of [
    "NO_COLOR",
    "FORCE_COLOR",
    "TERM",
    "COLORTERM",
    "WT_SESSION",
  ])
    delete environment[key];
  const processHandle = spawn(
    process.env.FLUENTA_TEST_EXE ?? join(root, "target/debug/fluenta.exe"),
    args,
    {
      cwd: root,
      windowsHide: true,
      env: {
        ...environment,
        FLUENTA_HEADLESS: "1",
        FLUENTA_DATA_DIR: directory,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9224",
        ...(process.env.FLUENTA_TEST_OFFLINE
          ? {
              HTTP_PROXY: "http://127.0.0.1:9",
              HTTPS_PROXY: "http://127.0.0.1:9",
              NO_PROXY: "localhost,127.0.0.1",
            }
          : {}),
      },
    },
  );
  for (const stream of [processHandle.stdout, processHandle.stderr]) {
    stream?.on("data", (chunk) =>
      appendFileSync(join(directory, "native.log"), chunk),
    );
  }
  let browser: Browser | undefined;
  let connectionError: unknown;
  for (let attempt = 0; attempt < 240; attempt++) {
    if (processHandle.exitCode !== null)
      throw new Error(`Fluenta exited. See ${directory}/native.log`);
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9224");
      break;
    } catch (error) {
      connectionError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!browser) {
    processHandle.kill();
    throw new Error(
      `Native WebView2 did not become available. See ${directory}/native.log. ${connectionError}`,
    );
  }
  const page: Page = browser.contexts()[0].pages()[0];
  await page.waitForLoadState("domcontentloaded");
  if (process.env.FLUENTA_TEST_OFFLINE) {
    // Chromium's global offline switch also disables Tauri's virtual HTTP IPC.
    // Block external traffic while preserving that in-process transport.
    await browser.contexts()[0].route("**/*", (route) => {
      const url = new URL(route.request().url());
      return [
        "tauri.localhost",
        "ipc.localhost",
        "localhost",
        "127.0.0.1",
      ].includes(url.hostname) ||
        ["tauri:", "ipc:", "data:", "blob:"].includes(url.protocol)
        ? route.continue()
        : route.abort("internetdisconnected");
    });
  }
  return { page, processHandle };
}

export async function stopNative(processHandle: ChildProcess | undefined) {
  if (processHandle && processHandle.exitCode === null) {
    const exited = once(processHandle, "exit");
    processHandle.kill();
    await exited;
  }
}
