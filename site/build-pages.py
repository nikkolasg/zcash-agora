#!/usr/bin/env python3
"""Expands {{header}}, {{footer}} and {{anim:name}} (site/assets/anim/<name>.html)
in every site/**/index.src.html into index.html. No dependencies."""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent
import json
cfg = json.loads((root / "agora.config.json").read_text())
base = cfg["site"]["base"]
# The audience measure (Umami, self-hosted): every page built here, never the vote page
# (site/app builds that one, and it loads nothing of the kind). Off until both values are set.
m = cfg.get("measure") or {}
measured = bool(m.get("url") and m.get("website"))
tag = f'<script defer src="{m.get("url", "").rstrip("/")}/script.js" data-website-id="{m.get("website", "")}" data-do-not-track="true" data-exclude-hash="true"></script>\n' if measured else ""
note = ' Visits to these pages are counted with a self-hosted <a href="https://umami.is">Umami</a>: no cookie, no address kept, and Do Not Track is respected. The vote page is not measured.' if measured else ""
header = (root / "_header.html").read_text()
footer = (root / "_footer.html").read_text()
def anim(m):
    return (root / "assets" / "anim" / f"{m.group(1)}.html").read_text()
for src in root.rglob("index.src.html"):
    if "app" in src.parts: continue
    html = src.read_text().replace("{{header}}", header).replace("{{footer}}", footer).replace("{{base}}", base)
    html = re.sub(r"\{\{anim:([a-z-]+)\}\}", anim, html)
    html = html.replace("{{measure}}", note)
    if measured:
        html = html.replace("</head>", tag + "</head>", 1)
        # How many go to the booth is counted here, as a click: the booth itself calls nothing.
        html = re.sub(r'(<a\b[^>]*href="vote/"[^>]*)>', r'\1 data-umami-event="go-vote">', html)
    (src.parent / "index.html").write_text(html)
    print("wrote", (src.parent / "index.html").relative_to(root))
