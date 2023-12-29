#!/bin/sh
### USED BY build-steam-release.yml GITHUB ACTIONS WORKFLOW.
### DO NOT RUN MANUALLY

# Copy files to Win64 Depot folder
if [ -f src-core/target/release/OyasumiVR.exe ]; then
cp src-core/target/release/OyasumiVR.exe SteamSDK/sdk/tools/ContentBuilder/content/Win64/
cp src-core/target/release/flags.toml SteamSDK/sdk/tools/ContentBuilder/content/Win64/
cp src-core/target/release/openvr_api.dll SteamSDK/sdk/tools/ContentBuilder/content/Win64/
cp src-core/target/release/steam_api64.dll SteamSDK/sdk/tools/ContentBuilder/content/Win64/
cp -r src-core/target/release/resources/ SteamSDK/sdk/tools/ContentBuilder/content/Win64/
elif [ -f src-core/target/debug/OyasumiVR.exe ]; then
cp src-core/target/debug/OyasumiVR.exe SteamSDK/sdk/tools/ContentBuilder/content/Win64/
cp src-core/target/debug/flags.toml SteamSDK/sdk/tools/ContentBuilder/content/Win64/
cp src-core/target/debug/openvr_api.dll SteamSDK/sdk/tools/ContentBuilder/content/Win64/
cp src-core/target/debug/steam_api64.dll SteamSDK/sdk/tools/ContentBuilder/content/Win64/
cp -r src-core/target/debug/resources/ SteamSDK/sdk/tools/ContentBuilder/content/Win64/
fi
