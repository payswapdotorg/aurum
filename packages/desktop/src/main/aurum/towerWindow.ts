/**
 * Aurum tower window (W012 Layer B): the ONE BrowserWindow mounting the
 * desktop tower page — the web tower components (source-alias reuse, the
 * W010 mount-agnostic ruling) over the RPC client behind the SAME
 * `TowerSession` shape. The live continuous session lives in the MAIN
 * process, so closing or reloading this window never loses state: the page
 * re-attaches through the envelope channel on every load.
 */
import { app, BrowserWindow } from "electron";
import type { BrowserWindow as BrowserWindowType } from "electron";
import { join } from "node:path";

const TOWER_WINDOW_TITLE = "Aurum Control Tower";
const preloadPath = join(import.meta.dirname, "../preload/aurumTower.cjs");

let instance: BrowserWindowType | null = null;

/** Opens (or focuses) the tower window — the AURUM_TOWER_OPEN_COMMAND_ID. */
export function openAurumTowerWindow(): void {
  if (instance && !instance.isDestroyed()) {
    instance.focus();
    return;
  }
  instance = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: TOWER_WINDOW_TITLE,
    backgroundColor: "#171717",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 生产包加载签名包内资源；开发态加载 vite dev server 的多页入口。
  if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    void instance.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/aurum-tower.html`);
  } else {
    void instance.loadFile(join(import.meta.dirname, "../renderer/aurum-tower.html"));
  }

  instance.on("closed", () => {
    instance = null;
  });
}
