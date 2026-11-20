@echo off
setlocal
rem 先把含空格的项目路径映射到 K:，workerd 在带空格的工作目录下会拒绝创建 miniflare-* 目录。
if not exist K:\ (
  subst K: "%~dp0"
  if errorlevel 1 (
    echo 无法创建 K: 盘映射，请手动执行：
    echo   subst K: "%~dp0"
    pause
    exit /b 1
  )
)
if not exist "K:\node_modules" (
  echo 还没有安装依赖，先按 RUN-WINDOWS.md 的“首次运行”执行 npm ci 等步骤。
  pause
  exit /b 1
)
if not exist "K:\game\dist" mkdir "K:\game\dist"
start "矿洞夺宝 · 游戏站" cmd /k "cd /d K:\game && ..\node_modules\.bin\wrangler.cmd dev --env local --port 8787 --ip 127.0.0.1"
start "矿洞夺宝 · 红包模拟器" cmd /k "cd /d K:\ && npm run page"
timeout /t 3 >nul
start "" http://127.0.0.1:8730
echo 已启动。关闭两个新窗口后，可以执行 subst K: /D 删除映射。
