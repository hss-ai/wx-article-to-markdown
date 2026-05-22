const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { convertFile } = require("./src/converter");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 780,
    height: 680,
    minWidth: 600,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "HTML2MD",
    autoHideMenuBar: true,
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("select-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select HTML files",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "HTML", extensions: ["html", "htm"] }],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select folder with HTML files",
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle("select-output", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select output folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle("convert", async (event, { files, outputDir, download }) => {
  const results = [];

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    event.sender.send("convert-progress", {
      current: i + 1,
      total: files.length,
      file: path.basename(filePath),
      status: "converting",
    });

    const result = convertFile(filePath, { outputDir, download });
    results.push({ input: filePath, ...result });

    event.sender.send("convert-progress", {
      current: i + 1,
      total: files.length,
      file: path.basename(filePath),
      status: result.error ? "error" : "done",
      result,
    });
  }

  return results;
});

ipcMain.handle("open-folder", async (event, folderPath) => {
  const { shell } = require("electron");
  shell.openPath(folderPath);
});

ipcMain.handle("list-html-in-dir", async (event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath);
    return entries
      .filter((f) => f.toLowerCase().endsWith(".html") || f.toLowerCase().endsWith(".htm"))
      .map((f) => path.join(dirPath, f));
  } catch {
    return [];
  }
});
