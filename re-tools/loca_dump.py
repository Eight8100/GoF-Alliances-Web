"""Dump the English localization table from data/base_loc_x/loca to data/loca_en.tsv (key<TAB>text)."""
import sys
sys.path.insert(0, "server")
import pb

rows = []
for f, wt, entry in pb.fields(open("data/base_loc_x/loca", "rb").read()):
    if f != 1:
        continue
    key, en = None, None
    for f2, _, v in pb.fields(entry):
        if f2 == 1:
            key = v.decode()
        elif f2 == 2:
            lang = dict((a, b) for a, _, b in pb.fields(v))
            if lang.get(1) == b"en":
                en = lang.get(2, b"").decode("utf-8", "replace")
    rows.append((key, en or ""))
with open("data/loca_en.tsv", "w") as out:
    for k, t in rows:
        out.write(f"{k}\t{t.replace(chr(10), ' | ')}\n")
print(len(rows), "entries")
