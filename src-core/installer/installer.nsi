!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define SHORTDESCRIPTION "{{short_description}}"
!define INSTALLMODE "{{install_mode}}"
!define LICENSE "{{license}}"
!define INSTALLERICON "{{installer_icon}}"
!define SIDEBARIMAGE "{{sidebar_image}}"
!define HEADERIMAGE "{{header_image}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define PLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define DISPLAYLANGUAGESELECTOR "{{display_language_selector}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH "{{webview2_bootstrapper_path}}"
!define WEBVIEW2INSTALLERPATH "{{webview2_installer_path}}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUPRODUCTKEY "Software\${MANUFACTURER}\${PRODUCTNAME}"

Name "${PRODUCTNAME}"
BrandingText "{{copyright}}"
OutFile "${OUTFILE}"
Unicode true
SetCompressor /SOLID lzma

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${SHORTDESCRIPTION}"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

;
; START OF DotNetCore.nsh
;
; A set of NSIS macros to check whether a dotnet core runtime is installed and, if not, offer to
; download and install it. Supports dotnet versions 3.1 and newer - latest tested version is 7.0.
;
; Inspired by & initially based on NsisDotNetChecker, which does the same thing for .NET framework
; https://github.com/alex-sitnikov/NsisDotNetChecker

!include "TextFunc.nsh"

!ifndef DOTNETCORE_INCLUDED
!define DOTNETCORE_INCLUDED

; Check that a specific version of the dotnet core runtime is installed and, if not, attempts to
; install it
;
; \param Version The desired dotnet core runtime version as a 2 digit version. e.g. 3.1, 6.0, 7.0
!macro CheckDotNetCore Version

	; Save registers
	Push $R0
	Push $R1
	Push $R2

	; Push and pop parameters so we don't have conflicts if parameters are $R#
	Push ${Version}
	Pop $R0 ; Version

	!define ID ${__LINE__}

	; Check current installed version
	!insertmacro DotNetCoreGetInstalledVersion $R0 $R1

	; If $R1 is blank then there is no version installed, otherwise it is installed
	; todo in future we might want to support "must be at least 6.0.7", for now we only deal with "yes/no" for a major version (e.g. 6.0)
	StrCmp $R1 "" notinstalled_${ID}
	DetailPrint ".NET Runtime version $R1 already installed"
	Goto end_${ID}

	notinstalled_${ID}:
	DetailPrint ".NET Runtime $R0 is not installed"

	!insertmacro DotNetCoreGetLatestVersion $R0 $R1
	DetailPrint "Latest Version of $R0 is $R1"


	; Get number of input digits
	; ${WordFind} $R1 "." "#" $R2
	; DetailPrint "version parts count is $R2"

	; ${WordFind} $R1 "." "+1" $R2
	; DetailPrint "version part 1 is $R2"

	; ${WordFind} $R1 "." "+2" $R2
	; DetailPrint "version part 2 is $R2"

	; ${WordFind} $R1 "." "+3" $R2
	; DetailPrint "version part 3 is $R2"

	!insertmacro DotNetCoreInstallVersion $R1

	end_${ID}:
	!undef ID

	; Restore registers
	Pop $R2
	Pop $R1
	Pop $R0

!macroend



; Gets the latest version of the runtime for a specified dotnet version. This uses the same endpoint
; as the dotnet-install scripts to determine the latest full version of a dotnet version
;
; \param[in] Version The desired dotnet core runtime version as a 2 digit version. e.g. 3.1, 6.0, 7.0
; \param[out] Result The full version number of the latest version - e.g. 6.0.7
!macro DotNetCoreGetLatestVersion Version Result

	; Save registers
	Push $R0
	Push $R1
	Push $R2

	; Push and pop parameters so we don't have conflicts if parameters are $R#
	Push ${Version}
	Pop $R0 ; Version

	StrCpy $R1 https://dotnetcli.azureedge.net/dotnet/Runtime/$R0/latest.version
	DetailPrint "Querying latest version of .NET Runtime $R0 from $R1"

	; Fetch latest version of the desired dotnet version
	; todo error handling in the PS script? so we can check for errors here
	StrCpy $R2 "Write-Host (Invoke-WebRequest -UseBasicParsing -URI $\"$R1$\").Content;"
	!insertmacro DotNetCorePSExec $R2 $R2
	; $R2 contains latest version, e.g. 6.0.7

	; todo error handling here

	; Push the result onto the stack
	${TrimNewLines} $R2 $R2
	Push $R2

	; Restore registers
	Exch
	Pop $R2
	Exch
	Pop $R1
	Exch
	Pop $R0

	; Set result
	Pop ${Result}

!macroend

!macro DotNetCoreGetInstalledVersion Version Result
	!define DNC_INS_ID ${__LINE__}

	; Save registers
	Push $R0
	Push $R1
	Push $R2

	; Push and pop parameters so we don't have conflicts if parameters are $R#
	Push ${Version}
	Pop $R0 ; Version

	DetailPrint "Checking installed version of .NET Runtime $R0"

	StrCpy $R1 "dotnet --list-runtimes | % { if($$_ -match $\".*NETCore.*($R0.\d+).*$\") { $$matches[1] } } | Sort-Object {[int]($$_ -replace '\d.\d.(\d+)', '$$1')} -Descending | Select-Object -first 1"
	!insertmacro DotNetCorePSExec $R1 $R1
	; $R1 contains highest installed version, e.g. 6.0.7

	${TrimNewLines} $R1 $R1

	; If there is an installed version it should start with the same two "words" as the input version,
	; otherwise assume we got an error response

	; todo improve this simple test which checks there are at least 3 "words" separated by periods
	${WordFind} $R1 "." "E#" $R2
	IfErrors error_${DNC_INS_ID}
	; $R2 contains number of version parts in R1 (dot separated words = version parts)

	; If less than 3 parts, or more than 4 parts, error
	IntCmp $R2 3 0 error_${DNC_INS_ID}
	IntCmp $R2 4 0 0 error_${DNC_INS_ID}

	; todo more error handling here / validation

	; Seems to be OK, skip the "set to blank string" error handler
	Goto end_${DNC_INS_ID}

	error_${DNC_INS_ID}:
	StrCpy $R1 "" ; Set result to blank string if any error occurs (means not installed)

	end_${DNC_INS_ID}:
	!undef DNC_INS_ID

	; Push the result onto the stack
	Push $R1

	; Restore registers
	Exch
	Pop $R2
	Exch
	Pop $R1
	Exch
	Pop $R0

	; Set result
	Pop ${Result}

!macroend

!macro DotNetCoreInstallVersion Version

	; Save registers
	Push $R0
	Push $R1
	Push $R2
	Push $R3

	; Push and pop parameters so we don't have conflicts if parameters are $R#
	Push ${Version}
	Pop $R0 ; Version

	${If} ${IsNativeAMD64}
		StrCpy $R3 "x64"
	${ElseIf} ${IsNativeARM64}
		StrCpy $R3 "arm64"
	${ElseIf} ${IsNativeIA32}
		StrCpy $R3 "x86"
	${Else}
		StrCpy $R3 "unknown"
	${EndIf}

	; todo can download as a .zip, which is smaller, then we'd need to unzip it before running it...
	StrCpy $R1 https://dotnetcli.azureedge.net/dotnet/Runtime/$R0/dotnet-runtime-$R0-win-$R3.exe

	; For dotnet versions less than 5 the WindowsDesktop runtime has a different path
	; ${WordFind} $R0 "." "+1" $R2
	; IntCmp $R2 5 +2 0 +2
	; StrCpy $R1 https://dotnetcli.azureedge.net/dotnet/Runtime/$R0/windowsdesktop-runtime-$R0-win-$R3.exe

	DetailPrint "Downloading .NET Runtime $R0 from $R1"

	; Create destination file
	GetTempFileName $R2
	nsExec::Exec 'cmd.exe /c rename "$R2" "$R2.exe"'	; Not using Rename to avoid spam in details log
	Pop $R3 ; Pop exit code
	StrCpy $R2 "$R2.exe"

	; Fetch runtime installer
	; todo error handling in the PS script? so we can check for errors here
	StrCpy $R1 "Invoke-WebRequest -UseBasicParsing -URI $\"$R1$\" -OutFile $\"$R2$\""
	!insertmacro DotNetCorePSExec $R1 $R1
	; $R1 contains powershell script result

	${WordFind} $R1 "BlobNotFound" "E+1{" $R3
	ifErrors +3 0
	DetailPrint ".NET Runtime installer $R0 not found."
	Goto +10

	; todo error handling for PS result, verify download result


	IfFileExists $R2 +3, 0
	DetailPrint ".NET Runtime installer did not download."
	Goto +7

	DetailPrint "Download complete"

	DetailPrint "Installing .NET Runtime $R0"
	ExecWait "$\"$R2$\" /install /quiet /norestart" $R1
	DetailPrint "Installer completed (Result: $R1)"

	nsExec::Exec 'cmd.exe /c del "$R2"'	; Not using Delete to avoid spam in details log
	Pop $R3 ; Pop exit code

	; Error checking? Verify install result?

	; Restore registers
	Pop $R3
	Pop $R2
	Pop $R1
	Pop $R0

!macroend

!macro CheckAspNetCore Version

	; Save registers
	Push $R0
	Push $R1
	Push $R2

	; Push and pop parameters so we don't have conflicts if parameters are $R#
	Push ${Version}
	Pop $R0 ; Version

	!define ID ${__LINE__}

	; Check current installed version
	!insertmacro AspNetCoreGetInstalledVersion $R0 $R1

	; If $R1 is blank then there is no version installed, otherwise it is installed
	; todo in future we might want to support "must be at least 6.0.7", for now we only deal with "yes/no" for a major version (e.g. 6.0)
	StrCmp $R1 "" notinstalled_${ID}
	DetailPrint "ASP.NET Core Runtime version $R1 already installed"
	Goto end_${ID}

	notinstalled_${ID}:
	DetailPrint "ASP.NET Core Runtime $R0 is not installed"

	!insertmacro AspNetCoreGetLatestVersion $R0 $R1
	DetailPrint "Latest Version of $R0 is $R1"


	; Get number of input digits
	; ${WordFind} $R1 "." "#" $R2
	; DetailPrint "version parts count is $R2"

	; ${WordFind} $R1 "." "+1" $R2
	; DetailPrint "version part 1 is $R2"

	; ${WordFind} $R1 "." "+2" $R2
	; DetailPrint "version part 2 is $R2"

	; ${WordFind} $R1 "." "+3" $R2
	; DetailPrint "version part 3 is $R2"

	!insertmacro AspNetCoreInstallVersion $R1

	end_${ID}:
	!undef ID

	; Restore registers
	Pop $R2
	Pop $R1
	Pop $R0

!macroend



; Gets the latest version of the runtime for a specified dotnet version. This uses the same endpoint
; as the dotnet-install scripts to determine the latest full version of a dotnet version
;
; \param[in] Version The desired dotnet core runtime version as a 2 digit version. e.g. 3.1, 6.0, 7.0
; \param[out] Result The full version number of the latest version - e.g. 6.0.7
!macro AspNetCoreGetLatestVersion Version Result

	; Save registers
	Push $R0
	Push $R1
	Push $R2

	; Push and pop parameters so we don't have conflicts if parameters are $R#
	Push ${Version}
	Pop $R0 ; Version

	StrCpy $R1 https://dotnetcli.azureedge.net/dotnet/aspnetcore/Runtime/$R0/latest.version
	DetailPrint "Querying latest version of ASP.NET Core Runtime $R0 from $R1"

	; Fetch latest version of the desired dotnet version
	; todo error handling in the PS script? so we can check for errors here
	StrCpy $R2 "Write-Host (Invoke-WebRequest -UseBasicParsing -URI $\"$R1$\").Content;"
	!insertmacro DotNetCorePSExec $R2 $R2
	; $R2 contains latest version, e.g. 6.0.7

	; todo error handling here

	; Push the result onto the stack
	${TrimNewLines} $R2 $R2
	Push $R2

	; Restore registers
	Exch
	Pop $R2
	Exch
	Pop $R1
	Exch
	Pop $R0

	; Set result
	Pop ${Result}

!macroend

!macro AspNetCoreGetInstalledVersion Version Result
	!define DNC_INS_ID ${__LINE__}

	; Save registers
	Push $R0
	Push $R1
	Push $R2

	; Push and pop parameters so we don't have conflicts if parameters are $R#
	Push ${Version}
	Pop $R0 ; Version

	DetailPrint "Checking installed version of ASP.NET Core Runtime $R0"

	StrCpy $R1 "dotnet --list-runtimes | % { if($$_ -match $\".*AspNetCore.*($R0.\d+).*$\") { $$matches[1] } } | Sort-Object {[int]($$_ -replace '\d.\d.(\d+)', '$$1')} -Descending | Select-Object -first 1"
	!insertmacro DotNetCorePSExec $R1 $R1
	; $R1 contains highest installed version, e.g. 6.0.7

	${TrimNewLines} $R1 $R1

	; If there is an installed version it should start with the same two "words" as the input version,
	; otherwise assume we got an error response

	; todo improve this simple test which checks there are at least 3 "words" separated by periods
	${WordFind} $R1 "." "E#" $R2
	IfErrors error_${DNC_INS_ID}
	; $R2 contains number of version parts in R1 (dot separated words = version parts)

	; If less than 3 parts, or more than 4 parts, error
	IntCmp $R2 3 0 error_${DNC_INS_ID}
	IntCmp $R2 4 0 0 error_${DNC_INS_ID}

	; todo more error handling here / validation

	; Seems to be OK, skip the "set to blank string" error handler
	Goto end_${DNC_INS_ID}

	error_${DNC_INS_ID}:
	StrCpy $R1 "" ; Set result to blank string if any error occurs (means not installed)

	end_${DNC_INS_ID}:
	!undef DNC_INS_ID

	; Push the result onto the stack
	Push $R1

	; Restore registers
	Exch
	Pop $R2
	Exch
	Pop $R1
	Exch
	Pop $R0

	; Set result
	Pop ${Result}

!macroend

!macro AspNetCoreInstallVersion Version

	; Save registers
	Push $R0
	Push $R1
	Push $R2
	Push $R3

	; Push and pop parameters so we don't have conflicts if parameters are $R#
	Push ${Version}
	Pop $R0 ; Version

	${If} ${IsNativeAMD64}
		StrCpy $R3 "x64"
	${ElseIf} ${IsNativeARM64}
		StrCpy $R3 "arm64"
	${ElseIf} ${IsNativeIA32}
		StrCpy $R3 "x86"
	${Else}
		StrCpy $R3 "unknown"
	${EndIf}

	; todo can download as a .zip, which is smaller, then we'd need to unzip it before running it...
	StrCpy $R1 https://dotnetcli.azureedge.net/dotnet/aspnetcore/Runtime/$R0/aspnetcore-runtime-$R0-win-$R3.exe

	DetailPrint "Downloading ASP.NET Core Runtime $R0 from $R1"

	; Create destination file
	GetTempFileName $R2
	nsExec::Exec 'cmd.exe /c rename "$R2" "$R2.exe"'	; Not using Rename to avoid spam in details log
	Pop $R3 ; Pop exit code
	StrCpy $R2 "$R2.exe"

	; Fetch runtime installer
	; todo error handling in the PS script? so we can check for errors here
	StrCpy $R1 "Invoke-WebRequest -UseBasicParsing -URI $\"$R1$\" -OutFile $\"$R2$\""
	!insertmacro DotNetCorePSExec $R1 $R1
	; $R1 contains powershell script result

	${WordFind} $R1 "BlobNotFound" "E+1{" $R3
	ifErrors +3 0
	DetailPrint "ASP.NET Core Runtime installer $R0 not found."
	Goto +10

	; todo error handling for PS result, verify download result


	IfFileExists $R2 +3, 0
	DetailPrint "ASP.NET Core Runtime installer did not download."
	Goto +7

	DetailPrint "Download complete"

	DetailPrint "Installing ASP.NET Core Runtime $R0"
	ExecWait "$\"$R2$\" /install /quiet /norestart" $R1
	DetailPrint "Installer completed (Result: $R1)"

	nsExec::Exec 'cmd.exe /c del "$R2"'	; Not using Delete to avoid spam in details log
	Pop $R3 ; Pop exit code

	; Error checking? Verify install result?

	; Restore registers
	Pop $R3
	Pop $R2
	Pop $R1
	Pop $R0

!macroend

; below is adapted from https://nsis.sourceforge.io/PowerShell_support but avoids using the plugin
; directory in favour of a temp file and providing a return variable rather than returning on the
; stack. Methods renamed to avoid conflicting with use of the original macros

; DotNetCorePSExec
; Executes a powershell script
;
; \param[in] PSCommand The powershell command or script to execute
; \param[out] Result The output from the powershell script
!macro DotNetCorePSExec PSCommand Result

	Push ${PSCommand}
	Call DotNetCorePSExecFn
	Pop ${Result}

!macroend

; DotNetCorePSExecFile
; Executes a powershell file
;
; \param[in] FilePath The path to the powershell script file to execute
; \param[out] Result The output from the powershell script
!macro DotNetCorePSExecFile FilePath Result

	Push ${FilePath}
	Call DotNetCorePSExecFileFn
	Pop ${Result}

!macroend

Function DotNetCorePSExecFn

	; Read parameters and save registers
	Exch $R0	; Script
	Push $R1
	Push $R2

	; Write the command into a temp file
	; Note: Using GetTempFileName to get a temp file name, but since we need to have a .ps1 extension
	; on the end we rename it with an extra file extension
	GetTempFileName $R1
	nsExec::Exec 'cmd.exe /c rename "$R1" "$R1.ps1"'	; Not using Rename to avoid spam in details log
	Pop $R2 ; Pop exit code
	StrCpy $R1 "$R1.ps1"

	FileOpen $R2 $R1 w
	FileWrite $R2 $R0
	FileClose $R2

	; Execute the powershell script and delete the temp file
	Push $R1
	Call DotNetCorePSExecFileFn
	nsExec::Exec 'cmd.exe /c del "$R1"'	; Not using Delete to avoid spam in details log
	Pop $R0 ; Pop exit code

	; Restore registers
	Exch
	Pop $R2
	Exch
	Pop $R1
	Exch
	Pop $R0

	; Stack contains script output only, which we leave as the function result

FunctionEnd

Function DotNetCorePSExecFileFn

	; Read parameters and save registers
	Exch $R0	; FilePath
	Push $R1

	nsExec::ExecToStack 'powershell -inputformat none -ExecutionPolicy RemoteSigned -File "$R0"  '
	; Stack contain exitCode, scriptOutput, registers

	; Pop exit code & validate
	Pop $R1
	IntCmp $R1 0 +2
	SetErrorLevel 2

	; Restore registers
	Exch
	Pop $R1
	Exch
	Pop $R0

	; Stack contains script output only, which we leave as the function result

FunctionEnd

!endif
;
; END OF DotNetCore.nsh
;

; Plugins path, currently exists for linux only
!if "${PLUGINSPATH}" != ""
    !addplugindir "${PLUGINSPATH}"
!endif

; Handle install mode, `perUser`, `perMachine` or `both`
!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel highest
!endif

!if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
!endif

!if "${INSTALLMODE}" == "both"
  !define MULTIUSER_MUI
  !define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCTNAME}"
  !define MULTIUSER_INSTALLMODE_COMMANDLINE
  !if "${ARCH}" == "x64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !else if "${ARCH}" == "arm64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !endif
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${UNINSTKEY}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "CurrentUser"
  !define MULTIUSER_INSTALLMODEPAGE_SHOWUSERNAME
  !define MULTIUSER_INSTALLMODE_FUNCTION RestorePreviousInstallLocation
  !define MULTIUSER_EXECUTIONLEVEL Highest
  !include MultiUser.nsh
!endif

; installer icon
!if "${INSTALLERICON}" != ""
  !define MUI_ICON "${INSTALLERICON}"
!endif

; installer sidebar image
!if "${SIDEBARIMAGE}" != ""
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"
!endif

; installer header image
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE_BITMAP  "${HEADERIMAGE}"
!endif

; Define registry key to store installer language
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${MANUPRODUCTKEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"

; Installer pages, must be ordered as they appear
; 1. Welcome Page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_WELCOME

; 2. License Page (if defined)
!if "${LICENSE}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MUI_PAGE_LICENSE "${LICENSE}"
!endif

; 3. Install mode (if it is set to `both`)
!if "${INSTALLMODE}" == "both"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MULTIUSER_PAGE_INSTALLMODE
!endif


; 4. Custom page to ask user if he wants to reinstall/uninstall
;    only if a previous installtion was detected
Var ReinstallPageCheck
Page custom PageReinstall PageLeaveReinstall
Function PageReinstall
  ; Uninstall previous WiX installation if exists.
  ;
  ; A WiX installer stores the isntallation info in registry
  ; using a UUID and so we have to loop through all keys under
  ; `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`
  ; and check if `DisplayName` and `Publisher` keys match ${PRODUCTNAME} and ${MANUFACTURER}
  ;
  ; This has a potentional issue that there maybe another installation that matches
  ; our ${PRODUCTNAME} and ${MANUFACTURER} but wasn't installed by our WiX installer,
  ; however, this should be fine since the user will have to confirm the uninstallation
  ; and they can chose to abort it if doesn't make sense.
  StrCpy $0 0
  wix_loop:
    EnumRegKey $1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" wix_done ; Exit loop if there is no more keys to loop on
    IntOp $0 $0 + 1
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "Publisher"
    StrCmp "$R0$R1" "${PRODUCTNAME}${MANUFACTURER}" 0 wix_loop
    StrCpy $R5 "wix"
    StrCpy $R6 "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1"
    Goto compare_version
  wix_done:

  ; Check if there is an existing installation, if not, abort the reinstall page
  ReadRegStr $R0 SHCTX "${UNINSTKEY}" ""
  ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
  ${IfThen} "$R0$R1" == "" ${|} Abort ${|}

  ; Compare this installar version with the existing installation
  ; and modify the messages presented to the user accordingly
  compare_version:
  StrCpy $R4 "$(older)"
  ${If} $R5 == "wix"
    ReadRegStr $R0 HKLM "$R6" "DisplayVersion"
  ${Else}
    ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayVersion"
  ${EndIf}
  ${IfThen} $R0 == "" ${|} StrCpy $R4 "$(unknown)" ${|}

  nsis_tauri_utils::SemverCompare "${VERSION}" $R0
  Pop $R0
  ; Reinstalling the same version
  ${If} $R0 == 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(addOrReinstall)"
    StrCpy $R3 "$(uninstallApp)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(chooseMaintenanceOption)"
    StrCpy $R5 "2"
  ; Upgrading
  ${ElseIf} $R0 == 1
    StrCpy $R1 "$(olderOrUnknownVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    StrCpy $R3 "$(dontUninstall)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
    StrCpy $R5 "1"
  ; Downgrading
  ${ElseIf} $R0 == -1
    StrCpy $R1 "$(newerVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    !if "${ALLOWDOWNGRADES}" == "true"
      StrCpy $R3 "$(dontUninstall)"
    !else
      StrCpy $R3 "$(dontUninstallDowngrade)"
    !endif
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
    StrCpy $R5 "1"
  ${Else}
    Abort
  ${EndIf}

  Call SkipIfPassive

  nsDialogs::Create 1018
  Pop $R4
  ${IfThen} $(^RTL) == 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}

  ${NSD_CreateLabel} 0 0 100% 24u $R1
  Pop $R1

  ${NSD_CreateRadioButton} 30u 50u -30u 8u $R2
  Pop $R2
  ${NSD_OnClick} $R2 PageReinstallUpdateSelection

  ${NSD_CreateRadioButton} 30u 70u -30u 8u $R3
  Pop $R3
  ; disable this radio button if downgrading and downgrades are disabled
  !if "${ALLOWDOWNGRADES}" == "false"
    ${IfThen} $R0 == -1 ${|} EnableWindow $R3 0 ${|}
  !endif
  ${NSD_OnClick} $R3 PageReinstallUpdateSelection

  ; Check the first radio button if this the first time
  ; we enter this page or if the second button wasn't
  ; selected the last time we were on this page
  ${If} $ReinstallPageCheck != 2
    SendMessage $R2 ${BM_SETCHECK} ${BST_CHECKED} 0
  ${Else}
    SendMessage $R3 ${BM_SETCHECK} ${BST_CHECKED} 0
  ${EndIf}

  ${NSD_SetFocus} $R2
  nsDialogs::Show
FunctionEnd
Function PageReinstallUpdateSelection
  ${NSD_GetState} $R2 $R1
  ${If} $R1 == ${BST_CHECKED}
    StrCpy $ReinstallPageCheck 1
  ${Else}
    StrCpy $ReinstallPageCheck 2
  ${EndIf}
FunctionEnd
Function PageLeaveReinstall
  ${NSD_GetState} $R2 $R1

  ; $R5 holds whether we are reinstalling the same version or not
  ; $R5 == "1" -> different versions
  ; $R5 == "2" -> same version
  ;
  ; $R1 holds the radio buttons state. its meaning is dependant on the context
  StrCmp $R5 "1" 0 +2 ; Existing install is not the same version?
    StrCmp $R1 "1" reinst_uninstall reinst_done ; $R1 == "1", then user chose to uninstall existing version, otherwise skip uninstalling
  StrCmp $R1 "1" reinst_done ; Same version? skip uninstalling

  reinst_uninstall:
    HideWindow
    ClearErrors
    ExecWait '$R1 /P _?=$4' $0

    ${If} $R5 == "wix"
      ReadRegStr $R1 HKLM "$R6" "UninstallString"
      ExecWait '$R1' $0
    ${Else}
      ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
      ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
      ExecWait '$R1 _?=$4' $0
    ${EndIf}

    BringToFront

    ${IfThen} ${Errors} ${|} StrCpy $0 2 ${|} ; ExecWait failed, set fake exit code

    ${If} $0 <> 0
    ${OrIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
      ${If} $0 = 1 ; User aborted uninstaller?
        StrCmp $R5 "2" 0 +2 ; Is the existing install the same version?
          Quit ; ...yes, already installed, we are done
        Abort
      ${EndIf}
      MessageBox MB_ICONEXCLAMATION "$(unableToUninstall)"
      Abort
    ${Else}
      StrCpy $0 $R1 1
      ${IfThen} $0 == '"' ${|} StrCpy $R1 $R1 -1 1 ${|} ; Strip quotes from UninstallString
      Delete $R1
      RMDir $INSTDIR
    ${EndIf}
  reinst_done:
FunctionEnd

; 5. Choose install directoy page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_DIRECTORY

; 6. Start menu shortcut page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
Var AppStartMenuFolder
!insertmacro MUI_PAGE_STARTMENU Application $AppStartMenuFolder

; 7. Installation page
!insertmacro MUI_PAGE_INSTFILES

; 8. Finish page
;
; Don't auto jump to finish page after installation page,
; because the installation page has useful info that can be used debug any issues with the installer.
!define MUI_FINISHPAGE_NOAUTOCLOSE
; Use show readme button in the finish page as a button create a desktop shortcut
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "$(createDesktop)"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut
; Show run app after installation.
!define MUI_FINISHPAGE_RUN "$INSTDIR\${MAINBINARYNAME}.exe"
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_FINISH

; Uninstaller Pages
; 1. Confirm uninstall page
Var DeleteAppDataCheckbox
Var DeleteAppDataCheckboxState
!define /ifndef WS_EX_LAYOUTRTL         0x00400000
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.ConfirmShow
Function un.ConfirmShow
    FindWindow $1 "#32770" "" $HWNDPARENT ; Find inner dialog
    ${If} $(^RTL) == 1
      System::Call 'USER32::CreateWindowEx(i${__NSD_CheckBox_EXSTYLE}|${WS_EX_LAYOUTRTL},t"${__NSD_CheckBox_CLASS}",t "$(deleteAppData)",i${__NSD_CheckBox_STYLE},i 50,i 100,i 400, i 25,i$1,i0,i0,i0)i.s'
    ${Else}
      System::Call 'USER32::CreateWindowEx(i${__NSD_CheckBox_EXSTYLE},t"${__NSD_CheckBox_CLASS}",t "$(deleteAppData)",i${__NSD_CheckBox_STYLE},i 0,i 100,i 400, i 25,i$1,i0,i0,i0)i.s'
    ${EndIf}
    Pop $DeleteAppDataCheckbox
    SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $1
    SendMessage $DeleteAppDataCheckbox ${WM_SETFONT} $1 1
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.ConfirmLeave
Function un.ConfirmLeave
    SendMessage $DeleteAppDataCheckbox ${BM_GETCHECK} 0 0 $DeleteAppDataCheckboxState
FunctionEnd
!insertmacro MUI_UNPAGE_CONFIRM

; 2. Uninstalling Page
!insertmacro MUI_UNPAGE_INSTFILES

;Languages
{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}

Var PassiveMode
Function .onInit
  ${GetOptions} $CMDLINE "/P" $PassiveMode
  IfErrors +2 0
    StrCpy $PassiveMode 1

  !if "${DISPLAYLANGUAGESELECTOR}" == "true"
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !if "${INSTALLMODE}" == "currentUser"
    SetShellVarContext current
  !else if "${INSTALLMODE}" == "perMachine"
    SetShellVarContext all
  !endif

  ${If} ${RunningX64}
    !if "${ARCH}" == "x64"
      SetRegView 64
    !else if "${ARCH}" == "arm64"
      SetRegView 64
    !else
      SetRegView 32
    !endif
  ${EndIf}

  ${If} $INSTDIR == ""
    ; Set default install location
    !if "${INSTALLMODE}" == "perMachine"
      ${If} ${RunningX64}
        !if "${ARCH}" == "x64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else if "${ARCH}" == "arm64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else
          StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
        !endif
      ${Else}
        StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
      ${EndIf}
    !else if "${INSTALLMODE}" == "currentUser"
      StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"
    !endif

    Call RestorePreviousInstallLocation
  ${EndIf}


  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_INIT
  !endif
FunctionEnd


Section EarlyChecks
  ; Abort silent installer if downgrades is disabled
  !if "${ALLOWDOWNGRADES}" == "false"
  IfSilent 0 silent_downgrades_done
    ; If downgrading
    ${If} $R0 == -1
      System::Call 'kernel32::AttachConsole(i -1)i.r0'
      ${If} $0 != 0
        System::Call 'kernel32::GetStdHandle(i -11)i.r0'
        System::call 'kernel32::SetConsoleTextAttribute(i r0, i 0x0004)' ; set red color
        FileWrite $0 "$(silentDowngrades)"
      ${EndIf}
      Abort
    ${EndIf}
  silent_downgrades_done:
  !endif

SectionEnd

Section DotNetCore
  !insertmacro CheckDotNetCore 7.0
SectionEnd

Section AspNetCore
  !insertmacro CheckAspNetCore 7.0
SectionEnd

Section WebView2
  ; Check if Webview2 is already installed and skip this section
  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ReadRegStr $5 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"

  StrCmp $4 "" 0 webview2_done
  StrCmp $5 "" 0 webview2_done

  ; Webview2 install modes
  !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
    Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
    DetailPrint "$(webview2Downloading)"
    nsis_tauri_utils::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
    Pop $0
    ${If} $0 == 0
      DetailPrint "$(webview2DownloadSuccess)"
    ${Else}
      DetailPrint "$(webview2DownloadError)"
      Abort "$(webview2AbortError)"
    ${EndIf}
    StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
    Goto install_webview2
  !endif

  !if "${INSTALLWEBVIEW2MODE}" == "embedBootstrapper"
    CreateDirectory "$INSTDIR\redist"
    File "/oname=$INSTDIR\redist\MicrosoftEdgeWebview2Setup.exe" "${WEBVIEW2BOOTSTRAPPERPATH}"
    DetailPrint "$(installingWebview2)"
    StrCpy $6 "$INSTDIR\redist\MicrosoftEdgeWebview2Setup.exe"
    Goto install_webview2
  !endif

  !if "${INSTALLWEBVIEW2MODE}" == "offlineInstaller"
    CreateDirectory "$INSTDIR\redist"
    File "/oname=$INSTDIR\redist\MicrosoftEdgeWebView2RuntimeInstaller.exe" "${WEBVIEW2INSTALLERPATH}"
    DetailPrint "$(installingWebview2)"
    StrCpy $6 "$INSTDIR\redist\MicrosoftEdgeWebView2RuntimeInstaller.exe"
    Goto install_webview2
  !endif

  Goto webview2_done

  install_webview2:
    DetailPrint "$(installingWebview2)"
    ; $6 holds the path to the webview2 installer
    ExecWait "$6 ${WEBVIEW2INSTALLERARGS} /install" $1
    ${If} $1 == 0
      DetailPrint "$(webview2InstallSuccess)"
    ${Else}
      DetailPrint "$(webview2InstallError)"
      Abort "$(webview2AbortError)"
    ${EndIf}
  webview2_done:
SectionEnd

!macro CheckIfAppIsRunning
  nsis_tauri_utils::FindProcess "${MAINBINARYNAME}.exe"
  Pop $R0
  ${If} $R0 = 0
      IfSilent kill 0
      ${IfThen} $PassiveMode != 1 ${|} MessageBox MB_OKCANCEL "$(appRunningOkKill)" IDOK kill IDCANCEL cancel ${|}
      kill:
        nsis_tauri_utils::KillProcess "${MAINBINARYNAME}.exe"
        Pop $R0
        Sleep 500
        ${If} $R0 = 0
          Goto app_check_done
        ${Else}
          IfSilent silent ui
          silent:
            System::Call 'kernel32::AttachConsole(i -1)i.r0'
            ${If} $0 != 0
              System::Call 'kernel32::GetStdHandle(i -11)i.r0'
              System::call 'kernel32::SetConsoleTextAttribute(i r0, i 0x0004)' ; set red color
              FileWrite $0 "$(appRunning)$\n"
            ${EndIf}
            Abort
          ui:
            Abort "$(failedToKillApp)"
        ${EndIf}
      cancel:
        Abort "$(appRunning)"
  ${EndIf}
  app_check_done:
!macroend

Var AppSize
Section Install
  SetOutPath $INSTDIR
  StrCpy $AppSize 0

  !insertmacro CheckIfAppIsRunning

  ; Copy main executable
  File "${MAINBINARYSRCPATH}"
  ${GetSize} "$INSTDIR" "/M=${MAINBINARYNAME}.exe /S=0B" $0 $1 $2
  IntOp $AppSize $AppSize + $0

  ; Copy resources
  {{#each resources}}
    CreateDirectory "$INSTDIR\\{{this.[0]}}"
    File /a "/oname={{this.[1]}}" "{{@key}}"
    ${GetSize} "$INSTDIR" "/M={{this.[1]}} /S=0B" $0 $1 $2
    IntOp $AppSize $AppSize + $0
  {{/each}}

  ; Copy external binaries
  {{#each binaries}}
    File /a "/oname={{this}}" "{{@key}}"
    ${GetSize} "$INSTDIR" "/M={{this}} /S=0B" $0 $1 $2
    IntOp $AppSize $AppSize + $0
  {{/each}}

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Save $INSTDIR in registry for future installations
  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR

  !if "${INSTALLMODE}" == "both"
    ; Save install mode to be selected by default for the next installation such as updating
    ; or when uninstalling
    WriteRegStr SHCTX "${UNINSTKEY}" $MultiUser.InstallMode 1
  !endif

  ; Registry information for add/remove programs
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" "1"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" "1"
  IntOp $AppSize $AppSize / 1000
  IntFmt $AppSize "0x%08X" $AppSize
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "$AppSize"

  ; Create start menu shortcut (GUI)
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    Call CreateStartMenuShortcut
  !insertmacro MUI_STARTMENU_WRITE_END

  ; Create shortcuts for silent and passive installers, which
  ; can be disabled by passing `/NS` flag
  ; GUI installer has buttons for users to control creating them
  IfSilent check_ns_flag 0
  ${IfThen} $PassiveMode == 1 ${|} Goto check_ns_flag ${|}
  Goto shortcuts_done
  check_ns_flag:
    ${GetOptions} $CMDLINE "/NS" $R0
    IfErrors 0 shortcuts_done
      Call CreateDesktopShortcut
      Call CreateStartMenuShortcut
  shortcuts_done:

  ; Auto close this page for passive mode
  ${IfThen} $PassiveMode == 1 ${|} SetAutoClose true ${|}
SectionEnd

Function .onInstSuccess
  ; Check for `/R` flag only in silent and passive installers because
  ; GUI installer has a toggle for the user to (re)start the app
  IfSilent check_r_flag 0
  ${IfThen} $PassiveMode == 1 ${|} Goto check_r_flag ${|}
  Goto run_done
  check_r_flag:
    ${GetOptions} $CMDLINE "/R" $R0
    IfErrors run_done 0
      Exec '"$INSTDIR\${MAINBINARYNAME}.exe"'
  run_done:
FunctionEnd

Function un.onInit
  ${If} ${RunningX64}
    !if "${ARCH}" == "x64"
      SetRegView 64
    !else if "${ARCH}" == "arm64"
      SetRegView 64
    !else
      SetRegView 32
    !endif
  ${EndIf}

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_UNINIT
  !endif

  !insertmacro MUI_UNGETLANGUAGE
FunctionEnd

Section Uninstall
  !insertmacro CheckIfAppIsRunning

  ; Delete the app directory and its content from disk
  ; Copy main executable
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"

  ; Delete resources
  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
    RMDir "$INSTDIR\\{{this.[0]}}"
  {{/each}}

  ; Delete external binaries
  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}

  ; Delete uninstaller
  Delete "$INSTDIR\uninstall.exe"

  RMDir "$INSTDIR"

  ; Remove start menu shortcut
  !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
  Delete "$SMPROGRAMS\$AppStartMenuFolder\${MAINBINARYNAME}.lnk"
  RMDir "$SMPROGRAMS\$AppStartMenuFolder"

  ; Remove desktop shortcuts
  Delete "$DESKTOP\${MAINBINARYNAME}.lnk"

  ; Delete app data
  ${If} $DeleteAppDataCheckboxState == 1
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}

  ; Remove registry information for add/remove programs
  !if "${INSTALLMODE}" == "both"
    DeleteRegKey SHCTX "${UNINSTKEY}"
  !else if "${INSTALLMODE}" == "perMachine"
    DeleteRegKey HKLM "${UNINSTKEY}"
  !else
    DeleteRegKey HKCU "${UNINSTKEY}"
  !endif

  DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"

  ${GetOptions} $CMDLINE "/P" $R0
  IfErrors +2 0
    SetAutoClose true
SectionEnd

Function RestorePreviousInstallLocation
  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
  StrCmp $4 "" +2 0
    StrCpy $INSTDIR $4
FunctionEnd

Function SkipIfPassive
  ${IfThen} $PassiveMode == 1  ${|} Abort ${|}
FunctionEnd

Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\${MAINBINARYNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  ApplicationID::Set "$DESKTOP\${MAINBINARYNAME}.lnk" "${BUNDLEID}"
FunctionEnd

Function CreateStartMenuShortcut
  CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
  CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${MAINBINARYNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  ApplicationID::Set "$SMPROGRAMS\$AppStartMenuFolder\${MAINBINARYNAME}.lnk" "${BUNDLEID}"
FunctionEnd
