import { readFile, writeFile, mkdir } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";
import { format } from "prettier";

const schema = JSON.parse(
  await readFile("crates/contracts/schema/protocol.schema.json", "utf8"),
);
const generated = await compile(schema, "Protocol", {
  bannerComment:
    "/* Generated from crates/contracts by npm run contracts. Do not edit. */",
  additionalProperties: false,
  unreachableDefinitions: true,
  style: { singleQuote: false, semi: true },
});
const result = await format(generated, { parser: "typescript" });
const target = "packages/contracts/src/index.ts";
if (process.argv.includes("--check")) {
  if (
    (await readFile(target, "utf8")).replaceAll("\r\n", "\n") !==
    result.replaceAll("\r\n", "\n")
  ) {
    throw new Error("Generated TypeScript is stale. Run npm run contracts.");
  }
  console.log("Generated TypeScript matches the Rust protocol.");
} else {
  await mkdir("packages/contracts/src", { recursive: true });
  await writeFile(target, result);
  console.log("Generated TypeScript from the Rust protocol.");
}
