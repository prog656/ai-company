' AI Company - desktop window launcher
'
' Starts the local server in the background, then opens the interface in an
' Edge app window: no address bar, no tabs, no bookmark bar. It looks and
' behaves like a native app, but the repo still ships zero dependencies.
'
' Double-click this file. To stop the app, close the window; the server exits
' with it on the next launch (or kill node from Task Manager).

Option Explicit

Dim fso, sh, here, edge, i, candidates

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)

' Start the server. If one is already listening on the port, this copy exits
' on its own and the existing instance keeps serving.
sh.CurrentDirectory = here
sh.Run "cmd /c node server.mjs", 0, False

' Give it a moment to bind.
WScript.Sleep 2200

' Prefer a real Edge install; fall back to the default browser.
candidates = Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe", _
  sh.ExpandEnvironmentStrings("%LocalAppData%") & "\Microsoft\Edge\Application\msedge.exe" )

edge = ""
For i = 0 To UBound(candidates)
  If fso.FileExists(candidates(i)) Then
    edge = candidates(i)
    Exit For
  End If
Next

If edge = "" Then
  sh.Run "http://localhost:4173", 1, False
Else
  sh.Run """" & edge & """ --app=http://localhost:4173 --window-size=540,880", 1, False
End If
