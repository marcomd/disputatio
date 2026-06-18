import { copyFile, unlink, access } from "node:fs/promises";
import { constants } from "node:fs";

const root = new URL("../", import.meta.url);
const repoReadme = new URL("README.md", root);
const backupReadme = new URL(".README.md.repo-backup", root);

try {
  await access(backupReadme, constants.F_OK);
} catch {
  process.exit(0);
}

await copyFile(backupReadme, repoReadme);
await unlink(backupReadme);
