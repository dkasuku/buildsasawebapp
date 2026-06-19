@echo off
REM Syncs the database schema (creates any missing tables), then loads demo data.
REM Saves the full output to seed-output.txt so it can be diagnosed if anything fails.
cd /d "%~dp0backend"
echo Running database sync + seed... (this saves a log to seed-output.txt)
echo.
(
  echo === STEP 1: prisma db push ===
  call npx prisma db push --accept-data-loss
  echo.
  echo === STEP 2: prisma db seed ===
  call npx prisma db seed
) > "%~dp0seed-output.txt" 2>&1
type "%~dp0seed-output.txt"
echo.
echo ============================================================
echo  Done. A full log was saved as seed-output.txt
echo  in the "ConstructAI Platform Design" folder.
echo  If it failed, that file has the details.
echo ============================================================
pause >nul
