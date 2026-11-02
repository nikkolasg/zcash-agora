#!/usr/bin/env python3
"""Expands {{header}} and {{footer}} in every site/**/index.src.html into index.html.
No dependencies. Run from anywhere: python3 site/build-pages.py"""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent
header = (root / "_header.html").read_text()
footer = (root / "_footer.html").read_text()
for src in root.rglob("index.src.html"):
    if "app" in src.parts: continue
    html = src.read_text().replace("{{header}}", header).replace("{{footer}}", footer)
    (src.parent / "index.html").write_text(html)
    print("wrote", (src.parent / "index.html").relative_to(root))
