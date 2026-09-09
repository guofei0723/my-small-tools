import { cp, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const packageDirectory = path.join(projectDirectory, "dist", "windows");
const executable = path.join(
  projectDirectory,
  "server",
  "target",
  "release",
  "my-small-tools.exe",
);
const frontendDistribution = path.join(projectDirectory, "frontend", "dist");
const launcher = path.join(scriptDirectory, "start-my-small-tools.vbs");

await rm(packageDirectory, { recursive: true, force: true });
await mkdir(path.join(packageDirectory, "frontend", "dist"), { recursive: true });
await copyFile(executable, path.join(packageDirectory, "my-small-tools.exe"));
await cp(frontendDistribution, path.join(packageDirectory, "frontend", "dist"), {
  recursive: true,
});
await copyFile(launcher, path.join(packageDirectory, "start-my-small-tools.vbs"));

console.log(`Windows package created at ${packageDirectory}`);
