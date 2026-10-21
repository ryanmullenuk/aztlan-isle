#!/bin/zsh
# Mac App Store build: the web game (dist/) inside the native Mac app, archived universal
# (Apple Silicon + Intel) and exported for App Store Connect. Pass "upload" to send it.
set -e
cd "$(dirname "$0")/.."
unset DEVELOPER_DIR
npm run build
BUILD=$(grep -m1 'CURRENT_PROJECT_VERSION' mac/AztlanIsle.xcodeproj/project.pbxproj | grep -o '[0-9]\+')
xcodebuild archive -project mac/AztlanIsle.xcodeproj -scheme AztlanIsle -configuration Release \
  -destination 'generic/platform=macOS' -archivePath "output/Mac$BUILD.xcarchive" -allowProvisioningUpdates -quiet
OPTIONS=mac/ExportOptions.plist
if [[ "$1" == "upload" ]]; then
  OPTIONS=output/MacExportUpload.plist
  sed 's#<string>export</string>#<string>upload</string>#' mac/ExportOptions.plist > "$OPTIONS"
fi
xcodebuild -exportArchive -archivePath "output/Mac$BUILD.xcarchive" -exportOptionsPlist "$OPTIONS" \
  -exportPath "output/mac-export$BUILD" -allowProvisioningUpdates
