; Keep the stable per-user installation directory selected by electron-builder:
; Windows UserProgramFiles (normally LocalAppData\Programs)\sift-desktop.
; Upgrades preserve opt-in login behavior. An actual uninstall removes Sift's
; login registration without touching saved conversions or the user-data folder.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "org.siftconverter.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "org.siftconverter.desktop"
  ${endif}
!macroend
