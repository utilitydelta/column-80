# native

The two binaries dictation spawns. `whisper-server` is whisper.cpp's HTTP server, resident from
activation. `column80-capture` is the microphone reader: miniaudio, one code path on Linux, macOS
and Windows, 16kHz mono PCM on stdout until stdin closes, `--list` for the devices.

Build for this box with `npm run native:build`; it stages `native/bin/<platform>-<arch>/`. The
release workflow does the same on four runners and packages one vsix per target. whisper.cpp is
pinned by tarball hash in `CMakeLists.txt`; bump the hash and the URL together.

Needs cmake 3.21+, a C and C++17 compiler. No SDK beyond the OS's: miniaudio loads the audio
backend at runtime and ggml is built CPU-only with AVX2 as the x64 floor.
