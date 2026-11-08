#!/usr/bin/env python3
"""Regenerates src/divipola/data.ts from the DANE DIVIPOLA dataset on datos.gov.co.

Usage: python3 -I scripts/generate-divipola.py && pnpm exec prettier --write src/divipola/data.ts
"""
import collections
import datetime
import json
import re
import sys
import urllib.request
from pathlib import Path

URL = "https://www.datos.gov.co/resource/gdxc-w37w.json?$limit=5000"
OUT = Path(__file__).resolve().parent.parent / "src" / "divipola" / "data.ts"
LOWER = {"DE", "DEL", "LA", "LAS", "LOS", "EL", "Y", "E"}


def title(name: str) -> str:
    if name == "BOGOTÁ, D.C.":
        return "Bogotá, D.C."
    words = name.split(" ")
    return " ".join(
        w if w == "-" else w.lower() if i > 0 and w in LOWER else w[:1] + w[1:].lower()
        for i, w in enumerate(words)
    )


def main() -> None:
    req = urllib.request.Request(URL, headers={"User-Agent": "sol-y-luna-build"})
    rows = json.load(urllib.request.urlopen(req, timeout=60))
    for r in rows:
        if not (re.fullmatch(r"\d{2}", r["cod_dpto"]) and re.fullmatch(r"\d{5}", r["cod_mpio"])):
            sys.exit(f"Fila inválida: {r}")
    deps = sorted({(r["cod_dpto"], r["dpto"]) for r in rows})
    by = collections.defaultdict(list)
    for r in sorted(rows, key=lambda r: r["cod_mpio"]):
        by[r["cod_dpto"]].append((r["cod_mpio"], title(r["nom_mpio"])))
    today = datetime.date.today().isoformat()
    lines = [
        "/**",
        " * DIVIPOLA — División Político-Administrativa de Colombia (DANE).",
        f" * Source: datos.gov.co dataset gdxc-w37w, downloaded {today}.",
        f" * {len(deps)} departamentos (incluye Bogotá D.C.) y {len(rows)} municipios / áreas no municipalizadas.",
        " * Generated file: regenerate instead of editing by hand.",
        " */",
        "",
        "export const DEPARTMENTS = [",
        *[f"  {{ code: '{c}', name: {json.dumps(title(n), ensure_ascii=False)} }}," for c, n in deps],
        "] as const satisfies readonly { code: string; name: string }[];",
        "",
        "/** Municipalities grouped by department code: [municipalityCode, name]. */",
        "export const MUNICIPALITIES_BY_DEPARTMENT: Readonly<Record<string, readonly (readonly [string, string])[]>> = {",
    ]
    for c, _ in deps:
        lines.append(f"  '{c}': [")
        lines += [f"    ['{mc}', {json.dumps(mn, ensure_ascii=False)}]," for mc, mn in by[c]]
        lines.append("  ],")
    lines.append("};")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(deps)} departamentos, {len(rows)} municipios → {OUT}")


if __name__ == "__main__":
    main()
