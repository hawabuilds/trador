#!/bin/sh
# Renders the three X post PNGs from index.html with headless Chrome.
cd "$(dirname "$0")"
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P="file://$PWD/index.html"
shot() { "$C" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=3000 --screenshot="$PWD/$1" --window-size="$2" "$P$3" 2>/dev/null; }
shot add-to-home-iphone-1080x1350.png 1080,1350 "?v=iphone"
shot add-to-home-android-1080x1350.png 1080,1350 "?v=android"
shot add-to-home-iphone-1600x900.png 1600,900 "?v=iphone&l=land"
