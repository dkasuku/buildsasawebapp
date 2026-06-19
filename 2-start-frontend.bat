@echo off
REM Starts the web app (frontend). Keep this window open while using the app.
cd /d "%~dp0"
echo Installing frontend dependencies (first run only, may take a minute)...
call npm install
echo.
echo Starting the app. When you see a "Local:  http://localhost:5173/" line below,
echo open that link in your browser. Press Ctrl+C in this window to stop the app.
echo.
call npm run dev
pause
