#!/bin/bash
### STEAM DEPLOY SCRIPT
### USED BY build-steam-release.yml GITHUB ACTIONS WORKFLOW.
### DO NOT RUN MANUALLY

# Clean up pre-existing files
rm -rf SteamSDK
# Unzip the SteamWorks SDK
unzip scripts/steam/lib/steamworks_sdk_157.zip -d SteamSDK
# Create Win64 Depot folder
mkdir -p SteamSDK/sdk/tools/ContentBuilder/content/Win64
# Copy files to Win64 Depot folder
cp src-core/target/release/OyasumiVR.exe SteamSDK/sdk/tools/ContentBuilder/content/Win64/
cp src-core/target/release/openvr_api.dll SteamSDK/sdk/tools/ContentBuilder/content/Win64/
cp -r src-core/target/release/resources/ SteamSDK/sdk/tools/ContentBuilder/content/Win64/
# Include WebView2 Installer
mkdir -p SteamSDK/sdk/tools/ContentBuilder/content/Win64/WebView2
curl -L https://go.microsoft.com/fwlink/p/?LinkId=2124703 --output SteamSDK/sdk/tools/ContentBuilder/content/Win64/WebView2/WebView2RuntimeInstaller.exe
# Include DotNet Installer
mkdir -p SteamSDK/sdk/tools/ContentBuilder/content/Win64/DotNet
curl -L https://dotnetcli.azureedge.net/dotnet/Runtime/7.0.9/dotnet-runtime-7.0.9-win-x64.exe --output SteamSDK/sdk/tools/ContentBuilder/content/Win64/DotNet/dotnet-runtime-7.0.9-win-x64.exe
# Include AspNet Installer
curl -L https://dotnetcli.azureedge.net/dotnet/aspnetcore/Runtime/7.0.9/aspnetcore-runtime-7.0.9-win-x64.exe --output SteamSDK/sdk/tools/ContentBuilder/content/Win64/DotNet/aspnetcore-runtime-7.0.9-win-x64.exe
# Clear default scripts
rm SteamSDK/sdk/tools/ContentBuilder/scripts/*
# Copy over scripts
cp scripts/steam/scripts/*.vdf SteamSDK/sdk/tools/ContentBuilder/scripts/
cp scripts/steam/install-scripts/*.vdf SteamSDK/sdk/tools/ContentBuilder/content/Win64/
# Replace variables
sed -i "s/APP_VERSION/$APP_VERSION/" SteamSDK/sdk/tools/ContentBuilder/scripts/*.vdf
sed -i "s/STEAM_APP_ID/$STEAM_APP_ID/" SteamSDK/sdk/tools/ContentBuilder/scripts/*.vdf
# Setup Steam authentication
cd SteamSDK/sdk/tools/ContentBuilder/builder
mkdir config
echo "$STEAM_CONFIG_VDF" | base64 -d > "config/config.vdf"
chmod 777 "config/config.vdf"
# Upload to Steam
./steamcmd.exe +login $STEAM_BUILD_USER +run_app_build ../scripts/app_$STEAM_APP_ID.vdf +quit
