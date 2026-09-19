Unicode true
Name "Fluenta"
OutFile "${OUTPUT}"
Icon "${ICON}"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
SetCompressor /SOLID lzma
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "Fluenta"
VIAddVersionKey /LANG=1033 "FileDescription" "Fluenta portable"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Fluenta contributors"

Section
  ; ponytail: re-extracts on launch; add a verified cache only if startup is too slow.
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\Fluenta"
  File /oname=fluenta.exe "${BINARY}"
  File /r "${RESOURCES}\courses"
  File /r "${RESOURCES}\models"
  File /r "${RESOURCES}\runtimes"
  File /r "${RESOURCES}\notices"
  File "${RESOURCES}\resource-manifest.json"
  ClearErrors
  ExecWait '"$PLUGINSDIR\Fluenta\fluenta.exe"' $0
  IfErrors 0 +3
    MessageBox MB_OK|MB_ICONSTOP "Fluenta could not start. Check that Microsoft WebView2 is installed."
    SetErrorLevel 1
SectionEnd
