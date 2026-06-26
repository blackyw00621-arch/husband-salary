Set WshShell = CreateObject("WScript.Shell")
workingDir = "D:\" & ChrW(20426) & ChrW(36066) & ChrW(29992)
WshShell.CurrentDirectory = workingDir
path = workingDir & "\pocketbase.exe"
WshShell.Run """" & path & """ serve --http=""0.0.0.0:8091""", 0, false
