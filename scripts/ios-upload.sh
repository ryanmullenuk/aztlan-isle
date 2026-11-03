#!/bin/zsh
# iPhone App Store build: the web game synced into the iOS app, archived and uploaded to App Store
# Connect (TestFlight). Signs in with the API key when one is set up (see asc-auth.sh).
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
source scripts/asc-auth.sh
npm run ios:sync
BUILD=$(grep -m1 'CURRENT_PROJECT_VERSION' ios/App/App.xcodeproj/project.pbxproj | grep -o '[0-9]\+')
rm -rf "output/iOS$BUILD.xcarchive" "output/ios-export$BUILD"
xcodebuild archive -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "output/iOS$BUILD.xcarchive" -allowProvisioningUpdates "${ASC_AUTH[@]}" -quiet
xcodebuild -exportArchive -archivePath "output/iOS$BUILD.xcarchive" -exportOptionsPlist ios/ExportOptions.plist \
  -exportPath "output/ios-export$BUILD" -allowProvisioningUpdates "${ASC_AUTH[@]}"
