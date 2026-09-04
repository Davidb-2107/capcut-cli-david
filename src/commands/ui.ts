import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { die } from "../utils/cli.js";

export function openInBrowser(target: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

export function cmdUi(printPathOnly: boolean): void {
  // dist/commands/ui.js → dist/ui/index.html
  const htmlPath = fileURLToPath(new URL("../ui/index.html", import.meta.url));
  if (!existsSync(htmlPath)) die(`page capacités introuvable (${htmlPath}) — build incomplet ?`);
  if (printPathOnly) {
    console.log(htmlPath);
    return;
  }
  openInBrowser(htmlPath);
  console.log(`ouvert : ${htmlPath}`);
}
