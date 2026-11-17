"""Build data/base_loc_en: the localisation zip with only the English texts (much smaller download).
Same structure as data/base_loc (zip of 'loca' + 'loca_version'); loca = protobuf {1 repeated entry
{1 key, 2 repeated {1 language code, 2 text}}}; every non-English language entry is dropped.

    python3 re-tools/loca_en_only.py
"""
import sys
import zipfile
sys.path.insert(0, "server")
import pb

z = zipfile.ZipFile("data/base_loc")
src = z.read("loca")
out, langs = b"", set()
for f, wt, v in pb.fields(src):
    if f != 1 or wt != 2:
        out += pb.ld(f, v) if wt == 2 else pb.v(f, v)
        continue
    entry = b""
    for f2, wt2, v2 in pb.fields(v):
        if f2 == 2:
            lang = dict((a, b) for a, _, b in pb.fields(v2))
            langs.add(lang.get(1))
            if lang.get(1) != b"en":
                continue
        entry += pb.ld(f2, v2) if wt2 == 2 else pb.v(f2, v2)
    out += pb.ld(1, entry)
with zipfile.ZipFile("data/base_loc_en", "w", zipfile.ZIP_DEFLATED) as w:
    w.writestr("loca", out)
    w.writestr("loca_version", z.read("loca_version"))
print("languages:", sorted(x.decode() for x in langs if x), "| loca", len(src), "->", len(out))
