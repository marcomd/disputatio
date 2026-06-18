import { copyFile, readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";

const root = new URL("../", import.meta.url);
const repoReadme = new URL("README.md", root);
const npmReadme = new URL("docs/npm-package.md", root);
const backupReadme = new URL(".README.md.repo-backup", root);

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (await exists(backupReadme)) {
  throw new Error(
    "Refusing to overwrite existing README backup. Run `npm run restore-readme` first.",
  );
}

await copyFile(repoReadme, backupReadme);
await writeFile(repoReadme, await readFile(npmReadme, "utf8"));
