import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { die } from "../utils/cli.js";
import { planUi } from "./ui.js";

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
  // dist/commands/ui-cli.js → dist/ui/index.html
  const htmlPath = fileURLToPath(new URL("../ui/index.html", import.meta.url));
  if (!existsSync(htmlPath)) die(`page capacités introuvable (${htmlPath}) — build incomplet ?`);
  const action = planUi(printPathOnly);
  if (action === "open-browser") openInBrowser(htmlPath);
  console.log(action === "open-browser" ? `ouvert : ${htmlPath}` : htmlPath);
}
