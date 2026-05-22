// State
let selectedFiles = [];
let lastOutputDir = null;

const inputEl = document.getElementById("inputPath");
const outputEl = document.getElementById("outputPath");
const fileCountEl = document.getElementById("fileCount");
const convertBtn = document.getElementById("convertBtn");
const progressSection = document.getElementById("progressSection");
const progressFill = document.getElementById("progressFill");
const statusText = document.getElementById("statusText");
const logSection = document.getElementById("logSection");
const logBox = document.getElementById("logBox");
const actionsDiv = document.getElementById("actions");
const optDownload = document.getElementById("optDownload");

// ---- Theme toggle ----

const themeToggle = document.getElementById("themeToggle");

function getPreferredTheme() {
  const stored = localStorage.getItem("theme");
  if (stored) return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}

applyTheme(getPreferredTheme());

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

// ---- Progress events ----

window.api.onProgress((data) => {
  const pct = Math.round((data.current / data.total) * 100);
  progressFill.style.width = pct + "%";
  statusText.textContent = `[${data.current}/${data.total}] ${data.file}`;

  if (data.status === "done") {
    appendLog(`[OK] ${data.file} => ${data.result.outputPath} (${data.result.images} images)`, "log-ok");
  } else if (data.status === "error") {
    appendLog(`[FAIL] ${data.file}: ${data.result.error}`, "log-fail");
  }
});

function appendLog(text, cls) {
  const span = document.createElement("span");
  span.className = cls || "log-info";
  span.textContent = text + "\n";
  logBox.appendChild(span);
  logBox.scrollTop = logBox.scrollHeight;
}

// ---- File picking ----

async function pickFiles() {
  const files = await window.api.selectFiles();
  if (files && files.length) {
    selectedFiles = files;
    inputEl.value = files.join("; ");
    fileCountEl.textContent = `${files.length} file(s) selected`;
  }
}

async function pickFolder() {
  const folder = await window.api.selectFolder();
  if (folder) {
    const htmlFiles = await window.api.listHtmlInDir(folder);
    if (htmlFiles.length === 0) {
      fileCountEl.textContent = "No HTML files found in this folder";
      return;
    }
    selectedFiles = htmlFiles;
    inputEl.value = folder;
    fileCountEl.textContent = `${htmlFiles.length} HTML file(s) found`;
  }
}

async function pickOutput() {
  const folder = await window.api.selectOutput();
  if (folder) {
    outputEl.value = folder;
  }
}

// ---- Conversion ----

async function startConvert() {
  if (selectedFiles.length === 0) {
    fileCountEl.textContent = "Please select input file(s) or folder first";
    return;
  }

  // UI: loading state
  convertBtn.disabled = true;
  convertBtn.textContent = "Converting...";
  progressSection.classList.add("visible");
  logSection.classList.remove("hidden");
  actionsDiv.classList.add("hidden");
  logBox.innerHTML = "";
  progressFill.style.width = "0%";

  const outputDir = outputEl.value.trim() || null;
  const download = optDownload.checked;

  appendLog(`Converting ${selectedFiles.length} file(s)...`, "log-info");

  try {
    const results = await window.api.convert({
      files: selectedFiles,
      outputDir,
      download,
    });

    const ok = results.filter((r) => !r.error);
    const fail = results.filter((r) => r.error);

    appendLog("");
    appendLog(`Done: ${ok.length} success, ${fail.length} failed`, "log-info");

    if (ok.length > 0) {
      const fullPath = ok[0].outputPath.replace(/\\/g, "/");
      lastOutputDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      actionsDiv.classList.remove("hidden");
    }
  } catch (err) {
    appendLog(`[ERROR] ${err.message || err}`, "log-fail");
  }

  convertBtn.disabled = false;
  convertBtn.textContent = "Convert";
  progressFill.style.width = "100%";
}

async function openOutput() {
  if (lastOutputDir) {
    await window.api.openFolder(lastOutputDir);
  }
}
