@echo off
echo ========================================
echo   MoosStudioza Launcher
echo ========================================
echo.

REM Check if .env file exists, create if not
if not exist ".env" (
    echo Creating default .env file...
    (
        echo PORT=3000
        echo NODE_ENV=development
        echo GROQ_API_KEY=your_groq_api_key_here
        echo SESSION_SECRET=your_session_secret_min_32_chars_here_change_in_production
        echo FIREBASE_PROJECT_ID=your_project_id
        echo FIREBASE_CLIENT_EMAIL=your_service_account_email
        echo FIREBASE_PRIVATE_KEY=your_private_key
        echo CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
        echo CLOUDFLARE_D1_DATABASE_ID=your_d1_database_id
        echo CLOUDFLARE_D1_JWT=your_d1_jwt3
    ) > ".env"
    echo WARNING: Please edit .env file with your actual API keys!
    echo.
)

echo Starting MoosStudioza...
echo.
echo The app will be available at: http://localhost:3000
echo.
echo Press Ctrl+C to stop the server.
echo ========================================
echo.

REM Try to kill any process on port 3000 first
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Killing process %%a on port 3000...
    taskkill /F /PID %%a 2>nul
)

REM Small delay to ensure port is freed
timeout /t 2 /nobreak >nul

REM Start the development server
start http://localhost:3000
call npm run dev
