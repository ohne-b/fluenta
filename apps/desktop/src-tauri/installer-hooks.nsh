!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ClearErrors
    ${GetOptions} $CMDLINE "/FLUENTA_REMOVE_DATA" $R0
    ${IfNot} ${Errors}
      StrCpy $DeleteAppDataCheckboxState 1
    ${EndIf}
    ClearErrors
    ${GetOptions} $CMDLINE "/FLUENTA_FROM_APP" $R0
    ${IfNot} ${Errors}
      ; Let the application close before Tauri checks for a running process.
      Sleep 1000
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    SetShellVarContext current
    ; The downloaded model and generated audio are not learning data.
    RMDir /r /REBOOTOK "$APPDATA\${BUNDLEID}\models"
    RMDir /r /REBOOTOK "$APPDATA\${BUNDLEID}\cache"
  ${EndIf}
!macroend
