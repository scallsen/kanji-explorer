#!/usr/bin/env python3
"""One-time prep: parse the raw downloads in data/raw/ into the three JSON
files the Neo4j loader reads (data/kanji.json, data/radicals.json,
data/words.json). Run once after scripts/download_data.sh. No network calls.

Scope: kanji taught by the end of Japanese elementary grade MAX_GRADE
(kanjidic2 <misc><grade>), ~640 characters for MAX_GRADE=4 — a cleaner,
unambiguous cutoff than kanjidic2's old pre-2010 JLPT scale.
"""
import json
import xml.etree.ElementTree as ET
from pathlib import Path

RAW = Path(__file__).parent.parent / "data" / "raw"
OUT = Path(__file__).parent.parent / "data"
MAX_GRADE = 4
MAX_WORDS_PER_KANJI = 25


def parse_kanjidic2():
    kanji = []
    for _, elem in ET.iterparse(RAW / "kanjidic2.xml", events=("end",)):
        if elem.tag != "character":
            continue
        literal = elem.findtext("literal")
        misc = elem.find("misc")
        grade = misc.findtext("grade") if misc is not None else None
        grade = int(grade) if grade else None
        if grade is None or grade > MAX_GRADE:
            elem.clear()
            continue
        jlpt = misc.findtext("jlpt") if misc is not None else None
        jlpt = int(jlpt) if jlpt else None

        readings, meanings = [], []
        rm = elem.find("reading_meaning")
        if rm is not None:
            for rmgroup in rm.findall("rmgroup"):
                for r in rmgroup.findall("reading"):
                    if r.get("r_type") in ("ja_on", "ja_kun"):
                        readings.append(r.text)
                for m in rmgroup.findall("meaning"):
                    if m.get("m_lang") is None:
                        meanings.append(m.text)

        kanji.append({
            "char": literal,
            "grade": grade,
            "jlpt_old_scale": jlpt,
            "readings": readings,
            "meanings": meanings,
        })
        elem.clear()
    return kanji


def parse_krad(scope_chars):
    with open(RAW / "krad.json", encoding="utf-8") as f:
        krad = json.load(f)
    # File is a list of {"literal": <kanji>, "components": [<radical>, ...]}
    by_char = {entry["literal"]: entry["components"] for entry in krad}
    return {char: by_char[char] for char in scope_chars if char in by_char}


def parse_jmdict_words(scope_chars):
    words = {c: [] for c in scope_chars}
    common_counts = {c: 0 for c in scope_chars}

    for _, elem in ET.iterparse(RAW / "JMdict_e", events=("end",)):
        if elem.tag != "entry":
            continue
        k_eles = elem.findall("k_ele")
        if not k_eles:
            elem.clear()
            continue

        glosses = [
            g.text
            for sense in elem.findall("sense")
            for g in sense.findall("gloss")
            if g.get("{http://www.w3.org/XML/1998/namespace}lang", "eng") == "eng"
        ]
        if not glosses:
            elem.clear()
            continue
        meaning = "; ".join(glosses[:3])

        matched_chars = set()
        is_common = False
        for k_ele in k_eles:
            keb = k_ele.findtext("keb")
            if not keb:
                continue
            if k_ele.find("ke_pri") is not None:
                is_common = True
            for char in scope_chars:
                if char in keb:
                    matched_chars.add(char)

        text = k_eles[0].findtext("keb")
        for char in matched_chars:
            bucket = words[char]
            if len(bucket) >= MAX_WORDS_PER_KANJI and not (
                is_common and common_counts[char] < MAX_WORDS_PER_KANJI
            ):
                continue
            bucket.append({"text": text, "meaning": meaning})
            if is_common:
                common_counts[char] += 1

        elem.clear()

    # Trim to cap, preferring nothing special (already capped during build,
    # but a very common kanji can exceed the cap slightly — hard trim here).
    for char in words:
        words[char] = words[char][:MAX_WORDS_PER_KANJI]
    return words


def main():
    print("Parsing kanjidic2.xml ...")
    kanji = parse_kanjidic2()
    scope_chars = {k["char"] for k in kanji}
    print(f"  {len(kanji)} kanji in scope (grade <= {MAX_GRADE})")

    print("Filtering krad.json ...")
    radicals = parse_krad(scope_chars)
    print(f"  {len(radicals)} kanji have radical decomposition")

    print("Streaming JMdict_e (this reads the full 218k-entry file once) ...")
    words = parse_jmdict_words(scope_chars)
    total_words = sum(len(v) for v in words.values())
    print(f"  {total_words} word entries indexed across {len(scope_chars)} kanji")

    OUT.joinpath("kanji.json").write_text(
        json.dumps(kanji, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    OUT.joinpath("radicals.json").write_text(
        json.dumps(radicals, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    OUT.joinpath("words.json").write_text(
        json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("Wrote data/kanji.json, data/radicals.json, data/words.json")


if __name__ == "__main__":
    main()
