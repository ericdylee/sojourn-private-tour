#!/usr/bin/env bash
# Vendors the brand webfonts into this directory.
#
# WHY: brand.css used to @import them from fonts.googleapis.com. A network
# failure then rendered every card in a fallback face while document.fonts.ready
# still resolved — the renderer reported success on a wrong result. Frame capture
# for reels makes that unacceptable, so the fonts are pinned here.
#
# Montserrat / Inter / Anton are all SIL OFL 1.1: vendoring and embedding are
# permitted. Licence texts sit next to the files.
#
# Re-run only to update the fonts. Output is committed.
set -euo pipefail
cd "$(dirname "$0")"

UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
API='https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700;800;900&family=Montserrat:wght@600;700;800&display=swap'

raw=$(curl -sS -A "$UA" "$API")

# Keep only the latin and latin-ext blocks. The campaign is English-only; the
# cyrillic/greek/vietnamese subsets are dead weight in the cache key.
printf '%s\n' "$raw" | awk '
  /^\/\* / { keep = ($2 == "latin" || $2 == "latin-ext") }
  keep     { print }
' > fonts.css

grep -o 'https://[^)]*\.woff2' fonts.css | sort -u | while read -r url; do
  name=$(basename "$url")
  [ -f "$name" ] || curl -sS -o "$name" "$url"
  # Rewrite the remote URL to the local file, in place.
  sed -i '' "s#$url#$name#g" fonts.css
done

echo "vendored $(ls -1 *.woff2 | wc -l | tr -d ' ') woff2 files"
