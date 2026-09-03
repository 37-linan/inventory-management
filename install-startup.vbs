' 安装开机自启动 - 出入库库存管理工作台
' 运行方式：双击此文件 或 右键 -> 用 Microsoft (R) Windows Based Script Host 打开

Dim WShell, StartupPath, ShortcutPath, TargetPath
Set WShell = CreateObject("WScript.Shell")

' 获取启动文件夹路径
StartupPath = WShell.SpecialFolders("Startup")
ShortcutPath = StartupPath & "\出入库库存管理.lnk"
TargetPath = WShell.CurrentDirectory & "\start.bat"

' 创建快捷方式
Set Shortcut = WShell.CreateShortcut(ShortcutPath)
Shortcut.TargetPath = TargetPath
Shortcut.WorkingDirectory = WShell.CurrentDirectory
Shortcut.WindowStyle = 7  ' 最小化窗口运行
Shortcut.Description = "出入库库存管理工作台 - 开机自启"
Shortcut.Save

MsgBox "开机自启动已设置成功！" & vbCrLf & vbCrLf & _
       "每次开机将自动启动出入库管理系统。" & vbCrLf & _
       "如需取消，请删除以下文件：" & vbCrLf & _
       ShortcutPath, vbInformation, "安装成功"

Set Shortcut = Nothing
Set WShell = Nothing
