#!/bin/bash
set -e

echo "Starting PyInstaller build..."

# unix = ':', win = ';'
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    SEPARATOR=";"
    echo "Targeting Windows..."
else
    SEPARATOR=":"
    echo "Targeting Unix..."
fi

# Run PyInstaller
pyinstaller --onefile --add-data "assets${SEPARATOR}assets" --collect-data imgui_bundle main.py

echo "Build complete."
