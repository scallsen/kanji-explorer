#!/usr/bin/env bash
# One-time download of the three raw data sources. Re-run is safe (idempotent).
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p data/raw

echo "Downloading kanjidic2.xml.gz ..."
curl -sL -o data/raw/kanjidic2.xml.gz "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz"
gunzip -kf data/raw/kanjidic2.xml.gz

echo "Downloading JMdict_e.gz ..."
curl -sL -o data/raw/JMdict_e.gz "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz"
gunzip -kf data/raw/JMdict_e.gz

echo "Downloading krad.json ..."
curl -sL -o data/raw/krad.json "https://raw.githubusercontent.com/hoffmannjp/krad-unicode/master/krad.json"

echo "Done. Raw files in data/raw/:"
ls -la data/raw/
