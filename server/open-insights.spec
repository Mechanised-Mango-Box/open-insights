# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller build definition for the portable server.

Built through scripts/build_portable.py, which stages the transcription weights
into build/models first - this file assumes they are already there.

    python scripts/build_portable.py

Onefile: one executable, no installer, no Python on the target machine. The cost
is that the bootloader unpacks the whole bundle into a temporary directory on
every launch, which is why paths.py is careful that nothing persistent is
written there.
"""

import os

from PyInstaller.utils.hooks import collect_all, collect_data_files

# The weights, staged by the build script from the faster-whisper cache and
# flattened. They land at sys._MEIPASS/models/<model name>, which is where
# config.WHISPER_MODEL_PATH looks for them.
datas = [(os.path.join(SPECPATH, "build", "models"), "models")]
binaries = []
hiddenimports = []

# Packages whose contents PyInstaller's import analysis cannot see, for two
# different reasons:
#
#   ctranslate2, onnxruntime, av, cv2  - the Python module is a thin wrapper
#       around shared libraries that are loaded by the extension module rather
#       than imported. Missing them is not a missing feature, it is a bundle
#       that cannot start. `av` also carries its own build of FFmpeg, which is
#       the only reason this server needs no system ffmpeg (see the Dockerfile).
#
#   limits, flask_limiter  - the rate limiter picks a storage backend from a URI
#       scheme at runtime. Nothing imports the in-memory backend by name, so
#       static analysis concludes, wrongly, that none of them are needed.
#
# tokenizers and huggingface_hub come in under faster-whisper; they are listed
# because collect_all on a dependency is cheaper to keep than to rediscover the
# next time an import moves.
for package in (
    "ctranslate2",
    "onnxruntime",
    "av",
    "cv2",
    "tokenizers",
    "huggingface_hub",
    "limits",
    "flask_limiter",
):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

# faster-whisper ships the silero VAD model as package data. Only needed when
# WHISPER_VAD=1, but it is a few megabytes and a bundle that cannot honour its
# own environment variable is worse than a slightly larger one.
datas += collect_data_files("faster_whisper")

a = Analysis(
    ["entry.py"],
    pathex=[SPECPATH],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Nothing on the request path imports any of these, and they are the largest
    # things that would otherwise be swept in from a development environment
    # that also runs model_training/. torch especially: faster-whisper exists
    # here precisely to avoid it, and letting it into the bundle would undo that
    # in one step.
    #
    # pandas joined the list when /api/analysis was removed - the client does
    # that arithmetic in the browser now, and it was the server's only importer.
    # numpy must NOT join it: cv2 and ctranslate2 load it at runtime, so a
    # bundle without it does not start.
    excludes=[
        "torch",
        "pandas",
        "matplotlib",
        "scipy",
        "sklearn",
        "joblib",
        "tkinter",
        "IPython",
        "pytest",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="open-insights-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # UPX off deliberately. It mangles the CUDA-style shared libraries that
    # ctranslate2 and onnxruntime ship, and the failure is a load error at
    # startup on the user's machine rather than anything visible at build time.
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    # A console application, because it is one: it logs what it is doing, prints
    # the connection instructions, and is stopped with Ctrl-C. Windowed would
    # hide all three and leave the user with a process they cannot see or end.
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
