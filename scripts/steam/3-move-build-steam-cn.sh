#!/bin/sh
### USED BY build-steam-release.yml GITHUB ACTIONS WORKFLOW.
### DO NOT RUN MANUALLY

# Copy files to Win64_CN Depot folder
cp src-core/target/release/OyasumiVR.exe SteamSDK/sdk/tools/ContentBuilder/content/Win64_CN/
cp src-core/target/release/openvr_api.dll SteamSDK/sdk/tools/ContentBuilder/content/Win64_CN/
cp src-core/target/release/steam_api64.dll SteamSDK/sdk/tools/ContentBuilder/content/Win64_CN/
cp -r src-core/target/release/resources/ SteamSDK/sdk/tools/ContentBuilder/content/Win64_CN/
