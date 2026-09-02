/*
 * column80-capture: the one microphone reader, every platform.
 *
 * Streams 16kHz mono signed-16-bit little-endian PCM to stdout from the moment the device
 * delivers its first buffer until stdin closes. The extension measures press-to-first-buffer by
 * the first byte on stdout, and stops the take by closing stdin; nothing captured is dropped on
 * the way out, because the main thread drains the ring buffer once more after the device stops.
 *
 *   column80-capture --list             capture devices as a JSON array on stdout
 *   column80-capture [--device NAME]    stream PCM; NAME is an exact name from --list
 *
 * Exit codes: 0 done, 2 no capture device, 3 the device would not open, 4 bad arguments,
 * 5 the named --device is not present (no silent fallback to the default: the extension owns
 * that decision and says so in its own voice).
 * miniaudio dlopens the OS audio backend at runtime, so this binary links nothing but libc.
 */
#define MINIAUDIO_IMPLEMENTATION
#define MA_NO_ENCODING
#define MA_NO_DECODING
#define MA_NO_GENERATION
#define MA_NO_RESOURCE_MANAGER
#define MA_NO_NODE_GRAPH
#define MA_NO_ENGINE
/* No null backend: with it, a box with no audio stack "captures" silence with exit 0 and the
 * no-device refusal can never fire (found by the phase 1 review under a mount namespace). */
#define MA_NO_NULL
#include "miniaudio.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#define read_stdin(buf, n) _read(0, (buf), (unsigned)(n))
#else
#include <signal.h>
#include <unistd.h>
#define read_stdin(buf, n) read(0, (buf), (n))
#endif

#define RATE 16000
#define RING_SECONDS 60

static ma_pcm_rb g_ring;
static volatile ma_bool32 g_stop = MA_FALSE;
static volatile ma_uint64 g_dropped = 0;

static void on_data(ma_device* device, void* out, const void* in, ma_uint32 frames) {
    (void)device;
    (void)out;
    const ma_uint8* src = (const ma_uint8*)in;
    while (frames > 0) {
        ma_uint32 n = frames;
        void* dst = NULL;
        if (ma_pcm_rb_acquire_write(&g_ring, &n, &dst) != MA_SUCCESS || n == 0) {
            g_dropped += frames;
            return;
        }
        memcpy(dst, src, (size_t)n * sizeof(ma_int16));
        ma_pcm_rb_commit_write(&g_ring, n);
        src += (size_t)n * sizeof(ma_int16);
        frames -= n;
    }
}

static ma_thread_result MA_THREADCALL stdin_watch(void* data) {
    (void)data;
    char buf[64];
    while (read_stdin(buf, sizeof buf) > 0) {
    }
    g_stop = MA_TRUE;
    return (ma_thread_result)0;
}

static void drain(void) {
    for (;;) {
        ma_uint32 n = 0xFFFFFFFFu;
        void* src = NULL;
        if (ma_pcm_rb_acquire_read(&g_ring, &n, &src) != MA_SUCCESS || n == 0) break;
        if (fwrite(src, sizeof(ma_int16), n, stdout) < n) g_stop = MA_TRUE;
        ma_pcm_rb_commit_read(&g_ring, n);
    }
    fflush(stdout);
}

static void json_string(const char* s) {
    putchar('"');
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') { putchar('\\'); putchar(c); }
        else if (c < 0x20) printf("\\u%04x", c);
        else putchar(c);
    }
    putchar('"');
}

static int list_devices(ma_context* ctx) {
    ma_device_info* infos = NULL;
    ma_uint32 count = 0;
    if (ma_context_get_devices(ctx, NULL, NULL, &infos, &count) != MA_SUCCESS) {
        fprintf(stderr, "could not enumerate capture devices\n");
        return 2;
    }
    printf("[");
    for (ma_uint32 i = 0; i < count; i++) {
        if (i) printf(",");
        printf("{\"name\":");
        json_string(infos[i].name);
        printf(",\"default\":%s}", infos[i].isDefault ? "true" : "false");
    }
    printf("]\n");
    fflush(stdout);
    return 0;
}

int main(int argc, char** argv) {
    const char* wanted = NULL;
    int list = 0;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--list") == 0) list = 1;
        else if (strcmp(argv[i], "--device") == 0 && i + 1 < argc) wanted = argv[++i];
        else { fprintf(stderr, "usage: column80-capture [--list] [--device NAME]\n"); return 4; }
    }
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stdin), _O_BINARY);
#else
    signal(SIGPIPE, SIG_IGN);
#endif

    ma_context ctx;
    if (ma_context_init(NULL, 0, NULL, &ctx) != MA_SUCCESS) {
        fprintf(stderr, "no audio backend could be opened\n");
        return 2;
    }
    if (list) { int rc = list_devices(&ctx); ma_context_uninit(&ctx); return rc; }

    ma_device_info* infos = NULL;
    ma_uint32 count = 0;
    ma_context_get_devices(&ctx, NULL, NULL, &infos, &count);
    if (count == 0) {
        fprintf(stderr, "no capture device\n");
        ma_context_uninit(&ctx);
        return 2;
    }
    const ma_device_id* id = NULL;
    const char* chosen = "system default";
    if (wanted != NULL) {
        for (ma_uint32 i = 0; i < count; i++) {
            if (strcmp(infos[i].name, wanted) == 0) { id = &infos[i].id; chosen = infos[i].name; break; }
        }
        if (id == NULL) {
            fprintf(stderr, "device not found: %s\n", wanted);
            ma_context_uninit(&ctx);
            return 5;
        }
    }

    if (ma_pcm_rb_init(ma_format_s16, 1, RATE * RING_SECONDS, NULL, NULL, &g_ring) != MA_SUCCESS) {
        fprintf(stderr, "ring buffer allocation failed\n");
        ma_context_uninit(&ctx);
        return 3;
    }

    ma_device_config cfg = ma_device_config_init(ma_device_type_capture);
    cfg.capture.pDeviceID = id;
    cfg.capture.format = ma_format_s16;
    cfg.capture.channels = 1;
    cfg.sampleRate = RATE;
    cfg.periodSizeInMilliseconds = 20;
    cfg.dataCallback = on_data;

    ma_device dev;
    if (ma_device_init(&ctx, &cfg, &dev) != MA_SUCCESS) {
        fprintf(stderr, "the capture device would not open: %s\n", chosen);
        ma_pcm_rb_uninit(&g_ring);
        ma_context_uninit(&ctx);
        return 3;
    }

    ma_thread watcher;
    if (ma_thread_create(&watcher, ma_thread_priority_normal, 0, stdin_watch, NULL, NULL) != MA_SUCCESS) {
        fprintf(stderr, "could not watch stdin\n");
        ma_device_uninit(&dev);
        ma_pcm_rb_uninit(&g_ring);
        ma_context_uninit(&ctx);
        return 3;
    }

    if (ma_device_start(&dev) != MA_SUCCESS) {
        fprintf(stderr, "the capture device would not start: %s\n", chosen);
        ma_device_uninit(&dev);
        ma_pcm_rb_uninit(&g_ring);
        ma_context_uninit(&ctx);
        return 3;
    }
    fprintf(stderr, "capturing device=%s rate=%d\n", chosen, RATE);

    while (!g_stop) {
        drain();
        ma_sleep(5);
    }
    ma_device_stop(&dev);
    drain();
    if (g_dropped) fprintf(stderr, "dropped frames=%llu\n", (unsigned long long)g_dropped);
    ma_device_uninit(&dev);
    ma_pcm_rb_uninit(&g_ring);
    ma_context_uninit(&ctx);
    return 0;
}
