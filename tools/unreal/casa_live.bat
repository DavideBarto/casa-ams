@echo off
rem Casa Live: opens Unreal with the flat and the planner, and keeps Unreal in step with every change in the planner.
rem Double-click it (or a desktop shortcut to it). Set PROJECT to your Unreal project if it lives elsewhere.
set "PROJECT=%USERPROFILE%\Documents\Unreal Projects\ApartAMS\ApartAMS.uproject"
set "EDITOR=C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe"

tasklist /fi "imagename eq UnrealEditor.exe" | find /i "UnrealEditor.exe" >nul || start "" "%EDITOR%" "%PROJECT%"
start "Casa Live (close to stop)" /min python "%~dp0live_bridge.py"
start "" "https://davidebarto.github.io/casa-ams/?live"
