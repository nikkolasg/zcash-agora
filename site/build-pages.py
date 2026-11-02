#!/usr/bin/env python3
"""Expands {{header}}, {{footer}} and {{anim:name}} (site/assets/anim/<name>.html)
in every site/**/index.src.html into index.html. No dependencies."""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent
import json
base = json.loads((root / "agora.config.json").read_text())["site"]["base"]
header = (root / "_header.html").read_text()
footer = (root / "_footer.html").read_text()
def anim(m):
    return (root / "assets" / "anim" / f"{m.group(1)}.html").read_text()
for src in root.rglob("index.src.html"):
    if "app" in src.parts: continue
    html = src.read_text().replace("{{header}}", header).replace("{{footer}}", footer).replace("{{base}}", base)
    html = re.sub(r"\{\{anim:([a-z-]+)\}\}", anim, html)
    (src.parent / "index.html").write_text(html)
    print("wrote", (src.parent / "index.html").relative_to(root))
