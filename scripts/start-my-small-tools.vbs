Option Explicit

Dim fileSystem, shell, packageDir, executablePath

Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

packageDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
executablePath = fileSystem.BuildPath(packageDir, "my-small-tools.exe")

' 以隐藏窗口启动后端，不自动打开浏览器；发布包使用 8686 避免与开发后端冲突。
shell.CurrentDirectory = packageDir
shell.Run """" & executablePath & """ --port 8686", 0, False
