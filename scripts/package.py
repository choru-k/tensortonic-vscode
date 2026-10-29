#!/usr/bin/env python3
"""Build an installable VSIX using only Python's standard library.

Uses an explicit allowlist to exclude tests, pairing data, caches, local
solutions, and research downloads. Never bundles the working tree wholesale.
"""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
NS = "http://schemas.microsoft.com/developer/vsx-schema/2011"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"


def element(parent, name, text=None, **attrs):
    node = ET.SubElement(parent, "{" + NS + "}" + name, attrs)
    if text is not None:
        node.text = str(text)
    return node


def manifest(package):
    ET.register_namespace("", NS)
    root = ET.Element("{" + NS + "}PackageManifest", {"Version": "2.0.0"})
    metadata = element(root, "Metadata")
    element(metadata, "Identity", Language="en-US", Id=package["name"], Version=package["version"], Publisher=package["publisher"])
    element(metadata, "DisplayName", package["displayName"])
    element(metadata, "Description", package["description"], **{"{http://www.w3.org/XML/1998/namespace}space": "preserve"})
    element(metadata, "Categories", ",".join(package.get("categories", [])))
    element(metadata, "Tags", ",".join(package.get("keywords", [])))
    properties = element(metadata, "Properties")
    for key, value in {
        "Microsoft.VisualStudio.Code.Engine": package["engines"]["vscode"],
        "Microsoft.VisualStudio.Code.ExtensionDependencies": "",
        "Microsoft.VisualStudio.Code.ExtensionPack": "",
        "Microsoft.VisualStudio.Code.ExtensionKind": ",".join(package.get("extensionKind", ["ui"])),
        "Microsoft.VisualStudio.Code.LocalizedLanguages": "",
        "Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown": "true",
    }.items():
        element(properties, "Property", Id=key, Value=value)
    installation = element(root, "Installation")
    element(installation, "InstallationTarget", Id="Microsoft.VisualStudio.Code")
    element(root, "Dependencies")
    assets = element(root, "Assets")
    for asset_type, path in [
        ("Microsoft.VisualStudio.Code.Manifest", "extension/package.json"),
        ("Microsoft.VisualStudio.Services.Content.Details", "extension/README.md"),
        ("Microsoft.VisualStudio.Services.Content.Changelog", "extension/CHANGELOG.md"),
        ("Microsoft.VisualStudio.Services.Content.License", "extension/LICENSE"),
    ]:
        element(assets, "Asset", Type=asset_type, Path=path, Addressable="true")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def content_types():
    ET.register_namespace("", CT)
    root = ET.Element("{" + CT + "}Types")
    for extension, content in {
        "json": "application/json", "js": "application/javascript",
        "md": "text/markdown", "svg": "image/svg+xml",
        "txt": "text/plain", "vsixmanifest": "text/xml",
    }.items():
        ET.SubElement(root, "{" + CT + "}Default", {"Extension": extension, "ContentType": content})
    ET.SubElement(root, "{" + CT + "}Override", {"PartName": "/extension/LICENSE", "ContentType": "text/plain"})
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def files_to_package():
    result = [ROOT / name for name in ("package.json", "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "LICENSE")]
    for directory, suffixes in (("src", {".js"}), ("media", {".svg", ".png"}), ("docs", {".md"})):
        base = ROOT / directory
        if base.exists():
            result.extend(path for path in sorted(base.rglob("*")) if path.is_file() and not path.is_symlink() and path.suffix in suffixes)
    required = [ROOT / "src/extension.js", ROOT / "src/client.js", ROOT / "src/bridge.js"]
    for path in result + required:
        if not path.is_file():
            raise SystemExit("Missing required package file: " + str(path.relative_to(ROOT)))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    package = json.loads((ROOT / "package.json").read_text())
    output = args.output or ROOT / "dist" / (package["name"] + "-" + package["version"] + ".vsix")
    output.parent.mkdir(parents=True, exist_ok=True)
    files = files_to_package()
    # Call manifest first, because ElementTree namespace registration is global.
    manifest_bytes = manifest(package)
    types_bytes = content_types()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("extension.vsixmanifest", manifest_bytes)
        archive.writestr("[Content_Types].xml", types_bytes)
        for path in files:
            archive.write(path, "extension/" + path.relative_to(ROOT).as_posix())
    print(str(output.resolve()))
    print("Packaged " + str(len(files)) + " extension files")


if __name__ == "__main__":
    main()
