"""Scripted models for the demo tasks and the end-to-end tests.

These are deterministic stand-ins for an orchestrator. They act only on what the
tools return (nothing about the files is hard-coded), so a test that passes with
them proves the harness, the tools, the permissions and the gates work — and the
same tests run unchanged against a real provider when one is configured.

``renewal_pack_policy`` is text-only on purpose: it never asks for an image.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..models.adapters.scripted import call, say
from ..models.types import Message, ModelResponse

_FEE = re.compile(r"annual fee for the current term is ([\d,]+) GBP")
_UPLIFT = re.compile(r"increases by ([\d.]+)% to ([\d,]+) GBP")
_NOUPLIFT = re.compile(r"No uplift applies")
_PARTY = re.compile(r"MASTER SERVICES AGREEMENT - ([A-Z0-9 &]+)")


def _tool_results(messages: list[Message]) -> list[tuple[str, str]]:
    return [(m.tool_name or "", m.text) for m in messages if m.role == "tool"]


def _turns(messages: list[Message]) -> int:
    return sum(1 for m in messages if m.role == "assistant")


def _num(s: str) -> int:
    return int(s.replace(",", ""))


def parse_contracts(results: list[tuple[str, str]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for name, text in results:
        if name != "read_file":
            continue
        fm = re.search(r"File: (\S+)", text)
        party = _PARTY.search(text)
        fee = _FEE.search(text)
        if not (fm and party and fee):
            continue
        up = _UPLIFT.search(text)
        out[party.group(1).strip().title()] = {
            "file": fm.group(1),
            "current": _num(fee.group(1)),
            "uplift": float(up.group(1)) if up else 0.0,
            "new": _num(up.group(2)) if up else _num(fee.group(1)),
            "clause": "7.2",
        }
    return out


def parse_workbook(results: list[tuple[str, str]]) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for name, text in results:
        if name != "read_file" or 'Sheet "Renewals"' not in text:
            continue
        for line in text.splitlines():
            m = re.match(r"A(\d+): ([^|]+?) \| B\1: (\S+) .*?D\1: ([\d.]+) \| E\1: ([\d.]+)", line)
            if m:
                rows[m.group(2).strip().title()] = {"row": int(m.group(1)), "file": m.group(3),
                                                    "current": int(float(m.group(4))), "pct": float(m.group(5))}
    return rows


def renewal_pack_policy(drive: Path, *, threshold_pct: float = 5.0):
    """"Build the Q3 renewal pack for Northwind from the contracts in the client folder,
    and flag anything that uplifts above five per cent." Files only."""
    contracts_dir = drive / "Contracts"
    workbook = drive / "Q3_Renewals.xlsx"
    pack = drive / "Q3_Renewal_Pack.xlsx"

    def policy(messages: list[Message], tools) -> ModelResponse:
        t = _turns(messages)
        results = _tool_results(messages)
        if t == 0:
            # Independent reads go in one turn.
            return call(("list_folder", {"path": str(drive)}), ("list_folder", {"path": str(contracts_dir)}),
                        text="I'll look through the client folder first.")
        if t == 1:
            listing = next((r for n, r in results if n == "list_folder" and (".pdf" in r or ".docx" in r)), "")
            files = re.findall(r"^(\S+\.(?:pdf|docx))\s", listing, re.MULTILINE)
            calls = [("read_file", {"path": str(contracts_dir / f)}) for f in files]
            calls.append(("read_file", {"path": str(workbook)}))
            return call(*calls)
        contracts = parse_contracts(results)
        book = parse_workbook(results)
        if t == 2:
            edits, disagreements = [], []
            for name, row in book.items():
                c = contracts.get(name)
                if c and abs(c["uplift"] - row["pct"]) > 1e-9:
                    edits.append({"sheet": "Renewals", "cell": f"E{row['row']}", "value": c["uplift"]})
                    disagreements.append(name)
            rows: list[list[Any]] = [["Account", "Contract", "Current annual value", "Uplift %", "New annual value",
                                      "Change", "Flag"]]
            for name in sorted(contracts):
                c = contracts[name]
                flag = []
                if c["uplift"] > threshold_pct:
                    flag.append(f"above {threshold_pct:g}%")
                if name in disagreements:
                    flag.append(f"workbook said {book[name]['pct']:g}%; contract clause {c['clause']} says {c['uplift']:g}%")
                rows.append([name, c["file"], c["current"], c["uplift"], c["new"], c["new"] - c["current"], "; ".join(flag)])
            calls = []
            if edits:
                calls.append(("edit_workbook", {"path": str(workbook), "edits": edits,
                                                "reason": "Match the signed contracts: " + ", ".join(disagreements) + "."}))
            calls.append(("create_workbook", {"path": str(pack), "sheets": [{"name": "Q3 renewal pack", "rows": rows}]}))
            return call(*calls)
        # Report.
        changed = {n: c for n, c in contracts.items() if c["new"] != c["current"]}
        total = sum(c["new"] - c["current"] for c in changed.values())
        above = [n for n, c in contracts.items() if c["uplift"] > threshold_pct]
        disagreements = [n for n, r in book.items() if n in contracts and abs(contracts[n]["uplift"] - r["pct"]) > 1e-9]
        not_saved = [text for n, text in results if text.startswith("Not written")]
        lines = [f"I read {len(contracts)} contracts and the Q3 workbook.",
                 f"{len(changed)} of {len(contracts)} accounts change at renewal, adding {total:,} to total annual value."]
        for n in disagreements:
            lines.append(f"{n}: the workbook had {book[n]['pct']:g}%; the signed contract (clause 7.2) says "
                         f"{contracts[n]['uplift']:g}%.")
        lines.append(f"Above {threshold_pct:g}%: " + (", ".join(above) if above else "none."))
        if not_saved:
            lines.append("Some changes were not approved, so nothing was saved for them.")
        else:
            lines.append(f"The pack is saved as {pack.name}.")
        return say("\n".join(lines))

    return policy
