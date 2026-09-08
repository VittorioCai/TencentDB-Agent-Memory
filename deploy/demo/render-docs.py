#!/usr/bin/env python3
"""Render the delivery's markdown into standalone pages for the demo site.

Run on a machine that has the repo (not on the server): the output is plain
HTML with the styles inline, so the demo host needs nothing but a static
file server. A CDN would have been less code and one more thing that can be
unreachable from where the reviewer sits.

Handles what these documents actually use: headings, fenced code, tables,
lists, blockquotes, links, bold and inline code. Anything else passes
through as a paragraph.
"""
import html
import pathlib
import re
import sys

CSS = """
:root { --fg:#1c1e21; --muted:#65676b; --line:#dfe1e5; --bg:#fff; --code:#f5f6f7; --accent:#1a4d8f; }
* { box-sizing: border-box; }
body { margin:0; font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; color:var(--fg); background:var(--bg); }
.wrap { max-width: 860px; margin: 0 auto; padding: 32px 24px 80px; }
nav.top { border-bottom:1px solid var(--line); background:#fafbfc; }
nav.top .wrap { padding:14px 24px; display:flex; gap:20px; align-items:baseline; flex-wrap:wrap; }
nav.top a { color:var(--accent); text-decoration:none; font-size:14px; }
nav.top a:hover { text-decoration:underline; }
nav.top .home { font-weight:600; color:var(--fg); }
h1 { font-size:26px; margin:28px 0 14px; line-height:1.3; }
h2 { font-size:20px; margin:32px 0 12px; padding-top:14px; border-top:1px solid var(--line); }
h3 { font-size:17px; margin:24px 0 8px; }
p { margin:12px 0; }
code { background:var(--code); padding:2px 5px; border-radius:3px; font-size:13px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
pre { background:var(--code); padding:14px 16px; border-radius:6px; overflow-x:auto; font-size:13px; line-height:1.5; }
pre code { background:none; padding:0; }
table { border-collapse:collapse; margin:16px 0; font-size:14px; display:block; overflow-x:auto; }
th, td { border:1px solid var(--line); padding:7px 11px; text-align:left; vertical-align:top; }
th { background:#f5f6f7; font-weight:600; }
blockquote { margin:14px 0; padding:2px 16px; border-left:3px solid var(--line); color:var(--muted); }
ul, ol { margin:12px 0; padding-left:26px; }
li { margin:5px 0; }
a { color:var(--accent); }
.note { background:#fff8e6; border:1px solid #f0d9a0; border-radius:6px; padding:12px 16px; margin:20px 0; font-size:14px; }
"""

def inline(t: str) -> str:
    t = html.escape(t)
    t = re.sub(r"`([^`]+)`", lambda m: f"<code>{m.group(1)}</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', t)
    return t

def render(md: str) -> str:
    out, lines, i = [], md.split("\n"), 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("```"):
            i += 1
            buf = []
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(html.escape(lines[i])); i += 1
            out.append("<pre><code>" + "\n".join(buf) + "</code></pre>"); i += 1; continue
        if re.match(r"^\|.*\|\s*$", ln) and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|\s*$", lines[i + 1]):
            cells = lambda r: [c.strip() for c in r.strip().strip("|").split("|")]
            head = cells(ln); i += 2
            rows = []
            while i < len(lines) and re.match(r"^\|.*\|\s*$", lines[i]):
                rows.append(cells(lines[i])); i += 1
            out.append("<table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
                       + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows)
                       + "</tbody></table>")
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", ln)
        if m:
            lvl = len(m.group(1)); out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>"); i += 1; continue
        if re.match(r"^\s*[-*]\s+", ln) or re.match(r"^\s*\d+\.\s+", ln):
            ordered = bool(re.match(r"^\s*\d+\.\s+", ln))
            items = []
            while i < len(lines) and (re.match(r"^\s*[-*]\s+", lines[i]) or re.match(r"^\s*\d+\.\s+", lines[i]) or (lines[i].startswith("  ") and lines[i].strip() and items)):
                if re.match(r"^\s*([-*]|\d+\.)\s+", lines[i]):
                    items.append(re.sub(r"^\s*([-*]|\d+\.)\s+", "", lines[i]))
                else:
                    items[-1] += " " + lines[i].strip()
                i += 1
            tag = "ol" if ordered else "ul"
            out.append(f"<{tag}>" + "".join(f"<li>{inline(x)}</li>" for x in items) + f"</{tag}>"); continue
        if ln.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].startswith(">"):
                buf.append(lines[i].lstrip("> ")); i += 1
            out.append(f"<blockquote>{inline(' '.join(buf))}</blockquote>"); continue
        if not ln.strip():
            i += 1; continue
        buf = []
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,4}\s|```|\||\s*[-*]\s|\s*\d+\.\s|>)", lines[i]):
            buf.append(lines[i]); i += 1
        out.append(f"<p>{inline(' '.join(buf))}</p>")
    return "\n".join(out)

NAV = """<nav class="top"><div class="wrap">
<a class="home" href="index.html">题目四 · 资产准入闸门</a>
<a href="index.html">总览</a>
<a href="batch3.html">第三批 off/on 对照</a>
<a href="gate.html">闸门设计与验证</a>
<a href="author.html">作者证据链</a>
<a href="plan.html">执行计划与修订记录</a>
</div></nav>"""

def page(title: str, body: str) -> str:
    return (f"<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
            f"<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            f"<title>{html.escape(title)}</title><style>{CSS}</style></head><body>"
            f"{NAV}<div class=\"wrap\">{body}</div></body></html>")

if __name__ == "__main__":
    repo = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "deploy/demo/site")
    out.mkdir(parents=True, exist_ok=True)
    for src, name, title in [
        ("evaluation/runner/COMPARISON-2026-09-08.md", "batch3.html", "第三批 off/on 对照"),
        ("evaluation/gate/README.md", "gate.html", "闸门设计与验证"),
        ("evaluation/author/README.md", "author.html", "作者证据链"),
        # The plan lives on the docs branch; pass its worktree as argv[3].
        (None, "plan.html", "执行计划与修订记录"),
    ]:
        p = (pathlib.Path(sys.argv[3]) / "docs/topic4-spec/16-execution-plan.md") if src is None else (repo / src)
        if src is None and len(sys.argv) < 4:
            print("  skip (no docs worktree given): plan.html"); continue
        if not p.exists():
            print(f"  skip (missing): {src}"); continue
        (out / name).write_text(page(title, render(p.read_text())), encoding="utf-8")
        print(f"  {src or p} → {out / name}")
