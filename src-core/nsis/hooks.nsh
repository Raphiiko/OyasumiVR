; Removes the uninstalling user's privileged launcher task, and the Program Files directory when
; no other user has one. The elevated sidecar does the removal and asks for elevation itself.
; The template deletes it from $INSTDIR before POSTUNINSTALL, and closes OyasumiVR only after
; PREUNINSTALL, so PREUNINSTALL keeps a copy and POSTUNINSTALL runs it.

!macro NSIS_HOOK_PREUNINSTALL
  ; A reinstall or manual upgrade runs this uninstaller in place, while a real uninstall runs a
  ; copy from %TEMP%. Updates pass /UPDATE. Both keep elevated features.
  ${If} $UpdateMode <> 1
  ${AndIf} $EXEDIR != $INSTDIR
    InitPluginsDir
    CopyFiles /SILENT "$INSTDIR\resources\elevated-sidecar\oyasumivr-elevated-sidecar.exe" "$PLUGINSDIR"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} ${FileExists} "$PLUGINSDIR\oyasumivr-elevated-sidecar.exe"
    ExecWait '"$PLUGINSDIR\oyasumivr-elevated-sidecar.exe" --uninstall'
  ${EndIf}
!macroend
