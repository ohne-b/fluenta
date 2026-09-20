import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ROOT, run } from "./build.mjs";

const compiler = path.join(
  process.env.LOCALAPPDATA ?? "",
  "tauri/NSIS/makensis.exe",
);
if (process.env.FLUENTA_REQUIRE_NSIS && !fs.existsSync(compiler)) {
  throw new Error("NSIS is required to verify uninstall behavior");
}
test(
  "native uninstall removes models, optionally removes learning data, and preserves updates",
  { skip: process.platform !== "win32" || !fs.existsSync(compiler) },
  () => {
    const id = `org.fluenta.uninstall-test.${randomUUID()}`;
    const work = path.join(ROOT, ".cache", id);
    const profile = path.join(process.env.APPDATA, id);
    fs.mkdirSync(work, { recursive: true });
    const executable = path.join(work, "check.exe");
    const script = path.join(work, "check.nsi");
    // A tiny installer exercises the production hooks without touching Fluenta itself.
    fs.writeFileSync(
      script,
      `Unicode true
!include LogicLib.nsh
!include FileFunc.nsh
!define BUNDLEID "${id}"
!include "${path.join(ROOT, "apps/desktop/src-tauri/installer-hooks.nsh")}"
Name "Fluenta uninstall test"
OutFile "${executable}"
RequestExecutionLevel user
SilentInstall silent
Var UpdateMode
Var DeleteAppDataCheckboxState
Section
  SetShellVarContext current
  StrCpy $UpdateMode 0
  StrCpy $DeleteAppDataCheckboxState 0
  ClearErrors
  \${GetOptions} $CMDLINE "/UPDATE" $R0
  \${IfNot} \${Errors}
    StrCpy $UpdateMode 1
  \${EndIf}
  !insertmacro NSIS_HOOK_PREUNINSTALL
  ; Same data-removal condition as Tauri's uninstaller template.
  \${If} $DeleteAppDataCheckboxState = 1
  \${AndIf} $UpdateMode <> 1
    RMDir /r "$APPDATA\\\${BUNDLEID}"
  \${EndIf}
  !insertmacro NSIS_HOOK_POSTUNINSTALL
SectionEnd
`,
    );
    run(compiler, ["/V2", script]);
    try {
      for (const [args, keepData, keepModel] of [
        [[], true, false],
        [["/FLUENTA_REMOVE_DATA"], false, false],
        [["/UPDATE", "/FLUENTA_REMOVE_DATA"], true, true],
      ]) {
        for (const name of [
          "models/model.gguf",
          "cache/speech/example.wav",
          "learner/student.sqlite",
        ]) {
          const file = path.join(profile, name);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, "test");
        }
        run(executable, args);
        assert.equal(
          fs.existsSync(path.join(profile, "learner/student.sqlite")),
          keepData,
        );
        assert.equal(
          fs.existsSync(path.join(profile, "models/model.gguf")),
          keepModel,
        );
        assert.equal(
          fs.existsSync(path.join(profile, "cache/speech/example.wav")),
          keepModel,
        );
      }
    } finally {
      assert.equal(path.dirname(profile), process.env.APPDATA);
      assert(path.basename(profile).startsWith("org.fluenta.uninstall-test."));
      fs.rmSync(profile, { recursive: true, force: true });
    }
  },
);
