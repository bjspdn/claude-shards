import { defineConfig } from "bunup"

export default defineConfig({
  entry: ["src/index.ts"],
  target: "bun",
  format: "esm",
  dts: false,
})
