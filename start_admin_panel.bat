@echo off
title Admin Panel - Sinhala Keyboard
echo Starting Admin Panel...
cd /d "%~dp0"
start "" "http://localhost:3000"
node server.js
