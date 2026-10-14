; Removes the privileged launcher's scheduled task and its Program Files directory on uninstall.
; The elevated sidecar does the removal, but the uninstaller deletes it from $INSTDIR before
; POSTUNINSTALL, and it can only run once the template has closed OyasumiVR, which happens after
; PREUNINSTALL. So PREUNINSTALL keeps a copy and POSTUNINSTALL runs it.

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
  ${AndIf} ${FileExists} "$PROGRAMFILES64\OyasumiVR\privileged\*.*"
    InitPluginsDir
    CopyFiles /SILENT "$INSTDIR\resources\elevated-sidecar\oyasumivr-elevated-sidecar.exe" "$PLUGINSDIR"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} ${FileExists} "$PLUGINSDIR\oyasumivr-elevated-sidecar.exe"
    ExecShellWait "runas" "$PLUGINSDIR\oyasumivr-elevated-sidecar.exe" "--uninstall" SW_HIDE
  ${EndIf}
!macroend
