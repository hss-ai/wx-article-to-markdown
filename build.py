#!/usr/bin/env python3
"""
build.py — Package the app into standalone executables using PyInstaller.

Usage:
  python build.py              # Build GUI executable
  python build.py --cli        # Build CLI executable
  python build.py --all        # Build both
"""

import os
import shutil
import subprocess
import sys


def check_pyinstaller():
    try:
        import PyInstaller  # noqa: F401
        return True
    except ImportError:
        print("PyInstaller not found. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])
        return True


def build_gui():
    print("Building GUI executable...")
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--windowed",
        "--name", "html2md-gui",
        "--clean",
        "--noconfirm",
        "gui.py",
    ]
    subprocess.check_call(cmd)
    print("GUI executable built: dist/html2md-gui.exe (or binary on Linux/Mac)")


def build_cli():
    print("Building CLI executable...")
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--name", "html2md",
        "--clean",
        "--noconfirm",
        "html2md.py",
    ]
    subprocess.check_call(cmd)
    print("CLI executable built: dist/html2md.exe (or binary on Linux/Mac)")


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    check_pyinstaller()

    build_all = "--all" in sys.argv
    build_cli_flag = "--cli" in sys.argv

    if build_all:
        build_gui()
        build_cli()
    elif build_cli_flag:
        build_cli()
    else:
        build_gui()

    # Clean up build artifacts
    if os.path.exists("build"):
        shutil.rmtree("build")

    print("\nDone! Executables are in the dist/ folder.")


if __name__ == "__main__":
    main()
