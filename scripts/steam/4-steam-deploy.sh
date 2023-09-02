#!/bin/bash
### STEAM DEPLOY SCRIPT
### USED BY build-steam-release.yml GITHUB ACTIONS WORKFLOW.
### DO NOT RUN MANUALLY

# Upload to Steam
./steamcmd.exe +login $STEAM_BUILD_USER +run_app_build ../scripts/app_$STEAM_APP_ID.vdf +quit
