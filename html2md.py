#!/usr/bin/env python3
"""
html2md.py — SingleFile HTML → Markdown converter (CLI)

Usage:
  # Interactive mode (just run it, no flags to remember):
  python html2md.py

  # Direct conversion:
  python html2md.py article.html
  python html2md.py *.html
  python html2md.py ./saved_pages/

  # Options:
  python html2md.py article.html -o ./output/
  python html2md.py article.html --no-download
"""

import argparse
import os
import sys

from core import convert_file, convert_batch


def interactive_mode():
    """Friendly interactive mode — just follow the prompts."""
    print("=" * 50)
    print("  HTML → Markdown Converter")
    print("  (SingleFile / WeChat / Zhihu / ...)")
    print("=" * 50)
    print()

    # 1. Ask for input
    print("Where are your HTML files?")
    print("  1) Current directory")
    print("  2) A specific folder")
    print("  3) A specific file")
    print()

    choice = input("Choose [1/2/3]: ").strip()

    sources = []
    if choice == "1":
        htmls = [f for f in os.listdir(".") if f.lower().endswith((".html", ".htm"))]
        if not htmls:
            print("No HTML files in current directory.")
            return
        print(f"\nFound {len(htmls)} HTML file(s):")
        for i, f in enumerate(htmls, 1):
            print(f"  {i}) {f}")
        print(f"  A) All")
        sel = input("\nSelect [number/A]: ").strip().upper()
        if sel == "A":
            sources = htmls
        else:
            try:
                sources = [htmls[int(sel) - 1]]
            except (ValueError, IndexError):
                print("Invalid selection.")
                return
    elif choice == "2":
        folder = input("Folder path: ").strip().strip('"')
        if not os.path.isdir(folder):
            print(f"Not a directory: {folder}")
            return
        sources = [folder]
    elif choice == "3":
        fpath = input("File path: ").strip().strip('"')
        if not os.path.isfile(fpath):
            print(f"File not found: {fpath}")
            return
        sources = [fpath]
    else:
        print("Invalid choice.")
        return

    if not sources:
        print("No files selected.")
        return

    # 2. Output directory
    print("\nOutput directory? (press Enter for same as source)")
    out_dir = input("> ").strip().strip('"') or None

    # 3. Download remote images?
    print("\nDownload remote images? [Y/n]")
    dl_choice = input("> ").strip().lower()
    download = dl_choice != "n"

    # 4. Convert
    print("\n--- Converting ---\n")
    results = convert_batch(
        sources,
        output_dir=out_dir,
        download=download,
        on_progress=lambda msg: print(f"  {msg}"),
    )

    # 5. Summary
    print("\n--- Results ---")
    ok = [r for r in results if not r.error]
    fail = [r for r in results if r.error]
    for r in ok:
        print(f"  [OK] {os.path.basename(r.input_path)}")
        print(f"       => {r.output_path}")
        print(f"       Title: {r.title}")
        print(f"       Images: {r.images}")
    for r in fail:
        print(f"  [FAIL] {os.path.basename(r.input_path)}: {r.error}")
    print(f"\nTotal: {len(ok)} success, {len(fail)} failed")


def main():
    parser = argparse.ArgumentParser(
        description="Convert SingleFile HTML pages to Markdown",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python html2md.py                          Interactive mode
  python html2md.py article.html             Convert single file
  python html2md.py *.html                   Convert all HTML in current dir
  python html2md.py ./saved_pages/           Convert all HTML in folder
  python html2md.py a.html -o ./output/      Specify output directory
  python html2md.py a.html --no-download     Skip remote image downloads
        """,
    )
    parser.add_argument("inputs", nargs="*", help="HTML files, folders, or globs")
    parser.add_argument("-o", "--output", help="Output directory (default: same as source)")
    parser.add_argument("--no-download", action="store_true", help="Skip remote image downloads")

    args = parser.parse_args()

    # No arguments → interactive mode
    if not args.inputs:
        interactive_mode()
        return

    results = convert_batch(
        args.inputs,
        output_dir=args.output,
        download=not args.no_download,
        on_progress=lambda msg: print(msg, file=sys.stderr),
    )

    ok = [r for r in results if not r.error]
    fail = [r for r in results if r.error]

    for r in ok:
        print(f"[OK] {os.path.basename(r.input_path)} => {r.output_path} ({r.images} images)")
    for r in fail:
        print(f"[FAIL] {os.path.basename(r.input_path)}: {r.error}", file=sys.stderr)

    print(f"\nDone: {len(ok)} success, {len(fail)} failed", file=sys.stderr)
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
