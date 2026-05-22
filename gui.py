#!/usr/bin/env python3
"""
gui.py — Cross-platform GUI for HTML → Markdown conversion
Uses tkinter (built-in, no extra install needed)
"""

import os
import sys
import threading
import tkinter as tk
from tkinter import filedialog, ttk

from core import convert_batch

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resource_path(relative):
    """Get absolute path for resources (works in PyInstaller bundle)."""
    if hasattr(sys, "_MEIPASS"):
        return os.path.join(sys._MEIPASS, relative)
    return os.path.join(os.path.abspath(os.path.dirname(__file__)), relative)


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("HTML → Markdown Converter")
        self.geometry("680x520")
        self.resizable(True, True)
        self._running = False

        self._build_ui()

    def _build_ui(self):
        pad = {"padx": 10, "pady": 4}

        # --- Input section ---
        input_frame = ttk.LabelFrame(self, text="Input", padding=8)
        input_frame.pack(fill="x", **pad)

        self.input_var = tk.StringVar()
        ttk.Entry(input_frame, textvariable=self.input_var).pack(side="left", fill="x", expand=True, padx=(0, 6))
        ttk.Button(input_frame, text="File(s)", command=self._pick_files).pack(side="left", padx=2)
        ttk.Button(input_frame, text="Folder", command=self._pick_folder).pack(side="left", padx=2)

        # --- Output section ---
        output_frame = ttk.LabelFrame(self, text="Output", padding=8)
        output_frame.pack(fill="x", **pad)

        self.output_var = tk.StringVar()
        ttk.Entry(output_frame, textvariable=self.output_var).pack(side="left", fill="x", expand=True, padx=(0, 6))
        ttk.Button(output_frame, text="Browse", command=self._pick_output).pack(side="left", padx=2)

        # --- Options ---
        opt_frame = ttk.LabelFrame(self, text="Options", padding=8)
        opt_frame.pack(fill="x", **pad)

        self.download_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(opt_frame, text="Download remote images", variable=self.download_var).pack(anchor="w")

        # --- Convert button ---
        self.convert_btn = ttk.Button(self, text="Convert", command=self._start_convert)
        self.convert_btn.pack(pady=8)

        # --- Progress ---
        prog_frame = ttk.Frame(self, padding=4)
        prog_frame.pack(fill="x", **pad)

        self.progress_var = tk.DoubleVar()
        ttk.Progressbar(prog_frame, variable=self.progress_var, maximum=100).pack(fill="x")
        self.status_var = tk.StringVar(value="Ready")
        ttk.Label(prog_frame, textvariable=self.status_var).pack(anchor="w", pady=(4, 0))

        # --- Log ---
        log_frame = ttk.LabelFrame(self, text="Log", padding=4)
        log_frame.pack(fill="both", expand=True, **pad)

        self.log = tk.Text(log_frame, height=10, state="disabled", wrap="word", font=("Consolas", 9))
        scrollbar = ttk.Scrollbar(log_frame, orient="vertical", command=self.log.yview)
        self.log.configure(yscrollcommand=scrollbar.set)
        self.log.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # --- Open output button (appears after conversion) ---
        self.open_btn = ttk.Button(self, text="Open Output Folder", command=self._open_output, state="disabled")
        self.open_btn.pack(pady=(0, 8))

    # ---- File pickers ----

    def _pick_files(self):
        files = filedialog.askopenfilenames(
            title="Select HTML files",
            filetypes=[("HTML files", "*.html *.htm"), ("All files", "*.*")],
        )
        if files:
            self.input_var.set("; ".join(files))

    def _pick_folder(self):
        folder = filedialog.askdirectory(title="Select folder with HTML files")
        if folder:
            self.input_var.set(folder)

    def _pick_output(self):
        folder = filedialog.askdirectory(title="Select output folder")
        if folder:
            self.output_var.set(folder)

    # ---- Logging ----

    def _log(self, msg):
        self.log.configure(state="normal")
        self.log.insert("end", msg + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    # ---- Conversion ----

    def _start_convert(self):
        if self._running:
            return

        input_text = self.input_var.get().strip()
        if not input_text:
            self.status_var.set("Please select input file(s) or folder")
            return

        sources = [s.strip().strip('"') for s in input_text.split(";") if s.strip()]
        output_dir = self.output_var.get().strip() or None
        download = self.download_var.get()

        self._running = True
        self.convert_btn.configure(state="disabled")
        self.progress_var.set(0)
        self.open_btn.configure(state="disabled")

        # Clear log
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")

        thread = threading.Thread(target=self._run, args=(sources, output_dir, download), daemon=True)
        thread.start()

    def _run(self, sources, output_dir, download):
        def on_progress(msg):
            self.after(0, lambda: self._log(msg))
            self.after(0, lambda: self.status_var.set(msg))

        try:
            results = convert_batch(sources, output_dir=output_dir, download=download, on_progress=on_progress)

            ok = [r for r in results if not r.error]
            fail = [r for r in results if r.error]

            self.after(0, lambda: self._log(""))
            for r in ok:
                self.after(0, lambda r=r: self._log(f"[OK] {os.path.basename(r.input_path)} => {r.output_path} ({r.images} images)"))
            for r in fail:
                self.after(0, lambda r=r: self._log(f"[FAIL] {os.path.basename(r.input_path)}: {r.error}"))

            summary = f"Done: {len(ok)} success, {len(fail)} failed"
            self.after(0, lambda: self._log(f"\n{summary}"))
            self.after(0, lambda: self.status_var.set(summary))
            self.after(0, lambda: self.progress_var.set(100))

            # Enable "Open Output Folder" button
            if ok and ok[0].output_path:
                self._last_output_dir = os.path.dirname(ok[0].output_path)
                self.after(0, lambda: self.open_btn.configure(state="normal"))

        except Exception as e:
            self.after(0, lambda: self._log(f"[ERROR] {e}"))
            self.after(0, lambda: self.status_var.set(f"Error: {e}"))
        finally:
            self._running = False
            self.after(0, lambda: self.convert_btn.configure(state="normal"))

    def _open_output(self):
        d = getattr(self, "_last_output_dir", None)
        if d and os.path.isdir(d):
            if sys.platform == "win32":
                os.startfile(d)
            elif sys.platform == "darwin":
                os.system(f'open "{d}"')
            else:
                os.system(f'xdg-open "{d}"')


def main():
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
