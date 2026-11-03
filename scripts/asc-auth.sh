#!/bin/zsh
# Sourced by the upload scripts: sets ASC_AUTH to xcodebuild's App Store Connect API key flags when
# ~/.appstoreconnect/aztlan.env names a key whose .p8 is in ~/.appstoreconnect/private_keys/, so
# uploads don't depend on an Apple Account signed in to Xcode. Otherwise ASC_AUTH is empty.
ASC_AUTH=()
# ASC_NO_KEY=1 signs in with the Apple Account in Xcode instead (cloud signing needs an Admin key).
if [[ -z "$ASC_NO_KEY" && -f ~/.appstoreconnect/aztlan.env ]]; then
  source ~/.appstoreconnect/aztlan.env
  KEY=~/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8
  if [[ -n "$ASC_KEY_ID" && -n "$ASC_ISSUER_ID" && -f "$KEY" ]]; then
    ASC_AUTH=(-authenticationKeyPath "$KEY" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
    echo "Using App Store Connect API key $ASC_KEY_ID"
  fi
fi
