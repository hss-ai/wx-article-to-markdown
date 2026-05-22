const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  selectFiles: () => ipcRenderer.invoke("select-files"),
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  selectOutput: () => ipcRenderer.invoke("select-output"),
  convert: (params) => ipcRenderer.invoke("convert", params),
  openFolder: (path) => ipcRenderer.invoke("open-folder", path),
  listHtmlInDir: (dir) => ipcRenderer.invoke("list-html-in-dir", dir),
  onProgress: (callback) => {
    ipcRenderer.on("convert-progress", (event, data) => callback(data));
  },
});
