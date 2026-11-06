"""Cut fonts for the HUD. Run by tools/fonts.mjs: python3 -I tools/subset-fonts.py jobs.json

Each job is {"src", "out", "family", "text"} plus "wght" for a variable source. Prints
{out: characters the written file holds} as JSON. A cut font is an OFL Modified Version, which
may not keep a Reserved Font Name (Lora, Nanum...), so every file is renamed to its HUD family
and keeps the original copyright, trademark and licence records.
"""
import json
import sys

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

NAMES = {1, 2, 3, 4, 6, 16, 17, 18, 21, 22, 25}  # every record that names the font
# The features a browser applies to horizontal text unasked; frac, numr and the like never run.
FEATURES = ["calt", "ccmp", "clig", "curs", "kern", "liga", "locl", "mark", "mkmk", "rclt", "rlig", "rvrn"]

held = {}
with open(sys.argv[1], encoding="utf-8") as f:
    jobs = json.load(f)
for job in jobs:
    font = TTFont(job["src"])
    if "wght" in job:
        font = instantiateVariableFont(font, {"wght": job["wght"]})
    options = Options()
    options.name_IDs = ["*"]
    options.layout_features = FEATURES
    options.hinting = False  # HUD text is scaled to any size; hints cost Nanum Pen Script 9 KB
    subsetter = Subsetter(options)
    subsetter.populate(text=job["text"])
    subsetter.subset(font)
    table = font["name"]
    table.names = [r for r in table.names if r.nameID not in NAMES]
    family, ps = job["family"], job["family"].replace(" ", "") + "-Regular"
    for name_id, value in {1: family, 2: "Regular", 3: ps + ";subset", 4: family, 6: ps}.items():
        table.setName(value, name_id, 3, 1, 0x409)
    font.flavor = "woff2"
    font.save(job["out"])
    held[job["out"]] = "".join(sorted(chr(u) for u in TTFont(job["out"]).getBestCmap()))
print(json.dumps(held, ensure_ascii=False))
