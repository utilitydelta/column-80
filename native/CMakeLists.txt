# The native side of dictation: two binaries the extension spawns.
#
#   whisper-server    whisper.cpp's HTTP server, resident from activation, one decode per request.
#   column80-capture  one cross-platform microphone reader (miniaudio) streaming 16kHz mono PCM.
#
# whisper.cpp is pinned by tarball hash, not by branch, so a rebuild a year from now produces the
# binary that was measured. Static libraries only: the vsix carries one file per binary and no
# .so/.dylib/.dll next to it. GGML_NATIVE is off because a vendored binary runs on the user's CPU,
# not the build box; AVX2 is the x64 floor (every desktop CPU since 2013).
cmake_minimum_required(VERSION 3.21)
project(column80-native C CXX)

set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES ON CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER ON CACHE BOOL "" FORCE)
set(WHISPER_SDL2 OFF CACHE BOOL "" FORCE)
set(WHISPER_CURL OFF CACHE BOOL "" FORCE)
if (CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|AMD64")
  set(GGML_AVX ON CACHE BOOL "" FORCE)
  set(GGML_AVX2 ON CACHE BOOL "" FORCE)
  set(GGML_FMA ON CACHE BOOL "" FORCE)
  set(GGML_F16C ON CACHE BOOL "" FORCE)
endif()

include(FetchContent)
# DOWNLOAD_EXTRACT_TIMESTAMP exists from cmake 3.24; ubuntu-22.04's runner ships 3.22.
if (CMAKE_VERSION VERSION_GREATER_EQUAL 3.24)
  set(WHISPER_TIMESTAMP DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
else()
  set(WHISPER_TIMESTAMP "")
endif()
FetchContent_Declare(
  whisper
  URL https://github.com/ggml-org/whisper.cpp/archive/eacbd8234c6654cdbf2c377f72b2106875479bdc.tar.gz
  URL_HASH SHA256=4c76358108ddc0442d59bc4a57d859519751fc93d3564d409413890524ee3b5a
  ${WHISPER_TIMESTAMP}
)
FetchContent_MakeAvailable(whisper)

add_executable(column80-capture capture/capture.c)
target_include_directories(column80-capture PRIVATE ${whisper_SOURCE_DIR}/examples)
if (APPLE)
  target_link_libraries(column80-capture PRIVATE "-framework CoreAudio" "-framework AudioToolbox" "-framework CoreFoundation" pthread m)
elseif (WIN32)
  target_link_libraries(column80-capture PRIVATE ole32)
else()
  target_link_libraries(column80-capture PRIVATE pthread m dl)
endif()

# No install rules: whisper.cpp's own would drag every example and library along. build.mjs
# copies the two binaries out of the build tree by name.
