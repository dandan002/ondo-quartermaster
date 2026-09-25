"""Reading Playwright MCP's accessibility snapshot.

The snapshot is YAML-ish: one element per line, ``- role "name" [ref=e6]``, with
a field's current value after a colon. We read three things from it: the page
URL, what a ref points at (so a gate can see "button \"Submit\"" rather than
"e6"), and the current value of every field (so an approval can show the exact
values about to land).
"""

from __future__ import annotations

import re

_LINE = re.compile(r'^\s*-\s+(?P<role>[a-z]+)(?:\s+"(?P<name>(?:[^"\\]|\\.)*)")?(?P<attrs>(?:\s+\[[^\]]*\])*)(?::\s*(?P<value>.*))?$')
_REF = re.compile(r"\[ref=([A-Za-z0-9_-]+)\]")
FIELD_ROLES = {"textbox", "searchbox", "combobox", "spinbutton", "checkbox", "radio", "slider"}


def page_url(text: str) -> str | None:
    m = re.search(r"^- Page URL: (.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else None


def page_title(text: str) -> str | None:
    m = re.search(r"^- Page Title: (.*)$", text, re.MULTILINE)
    return m.group(1).strip() if m else None


def elements(text: str) -> list[dict[str, str]]:
    out = []
    for line in text.splitlines():
        m = _LINE.match(line)
        if not m:
            continue
        ref = _REF.search(m.group("attrs") or "")
        if not ref:
            continue
        value = (m.group("value") or "").strip()
        if value.startswith('"') and value.endswith('"') and len(value) >= 2:
            value = value[1:-1]
        out.append({"role": m.group("role"), "name": (m.group("name") or "").replace('\\"', '"'),
                    "ref": ref.group(1), "value": value})
    return out


def describe(text: str, ref: str) -> str | None:
    for e in elements(text):
        if e["ref"] == ref:
            return f'{e["role"]} "{e["name"]}"' if e["name"] else e["role"]
    return None


def field_values(text: str) -> dict[str, str]:
    """Label -> current value for every form field on the page."""
    return {e["name"] or e["ref"]: e["value"] for e in elements(text) if e["role"] in FIELD_ROLES}
