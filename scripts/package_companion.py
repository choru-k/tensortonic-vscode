#!/usr/bin/env python3
"""Build a reviewable unpacked MV3 companion and ZIP, using only stdlib."""
import argparse
import json
from pathlib import Path
from shutil import copyfile
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "browser-companion"
SOURCE_FILES = ("manifest.json", "background.js", "shared.js", "companion.js", "popup.html", "popup.js", "popup.css", "README.md")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    unpacked = output / "tensortonic-browser-companion"
    if output == SOURCE or SOURCE in output.parents or output == ROOT / "src":
        raise SystemExit("Output must not overwrite companion or extension source.")
    if unpacked.is_symlink():
        raise SystemExit("Refusing a symlinked output folder.")
    unpacked.mkdir(parents=True, exist_ok=True)
    files = {name: SOURCE / name for name in SOURCE_FILES}
    files["connector.js"] = ROOT / "src/browser-connector.js"
    files["LICENSE"] = ROOT / "LICENSE"
    for name, source in files.items():
        if not source.is_file() or source.is_symlink() or (unpacked / name).is_symlink():
            raise SystemExit("Missing file or unsafe symlink: " + name)
    unknown = [item.name for item in unpacked.iterdir() if item.name not in files]
    if unknown:
        raise SystemExit("Refusing to reuse a folder with unexpected files: " + ", ".join(unknown))
    manifest = json.loads(files["manifest.json"].read_text())
    if manifest.get("manifest_version") != 3 or set(manifest.get("permissions", [])) != {"activeTab", "scripting", "storage"}:
        raise SystemExit("Unexpected companion manifest permissions.")
    forbidden = ("host_permissions", "content_scripts", "externally_connectable", "web_accessible_resources")
    if any(key in manifest for key in forbidden):
        raise SystemExit("Unexpected persistent, host or external access in companion manifest.")
    if manifest.get("optional_host_permissions") != ["https://www.tensortonic.com/*", "https://tensortonic.com/*"] or manifest.get("background") != {"service_worker": "background.js"}:
        raise SystemExit("Unexpected optional site access or service worker.")
    for name, source in files.items():
        copyfile(source, unpacked / name)
    archive = output / f"tensortonic-browser-companion-{manifest['version']}.zip"
    if archive.is_symlink():
        raise SystemExit("Refusing a symlinked archive.")
    with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
        for name in files:
            bundle.write(unpacked / name, name)
    print(str(unpacked))
    print(str(archive))
    print(f"Packaged {len(files)} files; activeTab + scripting + trusted storage; optional exact TensorTonic sites")


if __name__ == "__main__":
    main()
