# Dictation fixtures

Three piper utterances (en_GB-alan-medium) from the session-v65 scout, 16kHz mono s16le WAV
(piper writes a LIST chunk after `fmt `, so "the bytes after 44" carry a few metadata bytes as
audio; it is inaudible and every test tolerates it). They stand in for the microphone in the
headless and host-tier tests. What each says, as authored, and what the product's recogniser
(whisper.cpp base.en, beam 5, no VAD, 8 threads) heard on the reference box:

| file | authored | heard, every form seen |
|---|---|---|
| `threat-level-3s.wav` | Add the threat level column to the select list too. | `Add the threat level column to the select list 2.` or `... select list two.` |
| `min-max-6s.wav` | Set the min and max event timestamp fields on self from the min and max arguments. | same as authored |
| `fallback-batch-11s.wav` | Make a fallback batch from one through five off genesis hash, insert it into the downloader, catch up the test components, and record the tip hash as tip after five. | `Make a fallback batch from 1 through 5 off Genesis hash. Insert it into the\n downloader, catch up the test components and record the tip hash as tip after 5.` or the same with `full-back batch` |

The decoder is NOT run-to-run stable on identical bytes at temperature 0 with 8 threads: the
two forms above alternated across consecutive decodes on 2026-09-02. A test that asserts on
the transcript accepts every listed form after whitespace normalisation. The recogniser is a
dependency, not the thing under test.
