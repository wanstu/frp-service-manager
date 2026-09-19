#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob
debs=(dist/*-linux-amd64.deb)
if (( ${#debs[@]} != 1 )); then
  echo "expected exactly one Linux deb in dist/, found ${#debs[@]}" >&2
  exit 1
fi

deb="${debs[0]}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
dpkg-deb --extract "$deb" "$tmp"

required=(
  "usr/bin/frp-service-manager"
  "usr/share/applications/frp-service-manager.desktop"
  "usr/share/icons/hicolor/256x256/apps/frp-service-manager.png"
)
for path in "${required[@]}"; do
  if [[ ! -s "$tmp/$path" ]]; then
    echo "deb missing required file: /$path" >&2
    exit 1
  fi
done

icon="$tmp/usr/share/icons/hicolor/256x256/apps/frp-service-manager.png"
png_size_hex="$(od -An -tx1 -j16 -N8 "$icon" | tr -d ' \n')"
if [[ "$png_size_hex" != "0000010000000100" ]]; then
  echo "deb icon is not a 256x256 PNG: $icon (IHDR size=$png_size_hex)" >&2
  exit 1
fi

desktop="$tmp/usr/share/applications/frp-service-manager.desktop"
grep -Eq '^Exec=frp-service-manager$|^Exec=/usr/bin/frp-service-manager$' "$desktop"
grep -Fxq 'Icon=frp-service-manager' "$desktop"
grep -Fxq 'Terminal=false' "$desktop"

echo "Linux deb launcher icon verified: $deb"
