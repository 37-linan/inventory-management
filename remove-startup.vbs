' 取消开机自启动 - 出入库库存管理工作台
Dim WShell, StartupPath, ShortcutPath
Set WShell = CreateObject("WScript.Shell")

StartupPath = WShell.SpecialFolders("Startup")
ShortcutPath = StartupPath & "\出入库库存管理.lnk"

' 创建FileSystemObject来删除文件
Set FSO = CreateObject("Scripting.FileSystemObject")
If FSO.FileExists(ShortcutPath) Then
    FSO.DeleteFile ShortcutPath, True
    MsgBox "开机自启动已取消。", vbInformation, "取消成功"
Else
    MsgBox "未找到开机自启动设置，无需取消。", vbInformation, "无需操作"
End If

Set FSO = Nothing
Set WShell = Nothing
