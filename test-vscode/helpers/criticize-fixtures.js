'use strict';

// The per-language criticize fixture: a small, deliberately imperfect function
// appended to each dogfood repo's playground file, plus the needles a test uses
// to find its cursor and its doc line.
//
// EXTRACTED 2026-08-29 from `v61-criticize.test.js`, which owned it alone until
// the model-authored review gained a host row of its own. Two host suites
// pressing two commands at the same fixture is the point: a comparison between
// them is only a comparison if both are looking at the same function. A second
// copy of this block would drift on the first day someone tuned a fixture, and
// the two suites would then be measuring different code while reporting on the
// same one.

const MARKER = 'nothing below this line is inside a function';

const FIXTURES = {
  ts: {
    file: 'playground/src/fim.ts',
    name: 'spanProbe',
    docNeedle: 'Probe for the v61 host tier.',
    cursorNeedle: 'const c80Started = Date.now();',
    cleanNeedle: 'export function spanProbeCaller(): number {',
    text: [
      '',
      '/**',
      ' * Probe for the v61 host tier.',
      ' *',
      ' * @param first the first bound',
      ' * @param second the second bound',
      ' */',
      'export function spanProbe(first: number, second: number): number {',
      '  const c80Started = Date.now();',
      '  return first + second + c80Started;',
      '}',
      '',
      '/** Adds the two bounds the probe was built to add. */',
      'export function spanProbeCaller(): number {',
      '  return spanProbe(1, 2);',
      '}',
      '',
      `// ${MARKER}`,
      '',
    ].join('\n'),
  },
  rust: {
    file: 'crates/playground/src/fim.rs',
    name: 'span_probe',
    docNeedle: 'Probe for the v61 host tier.',
    cursorNeedle: 'let c80_started = std::time::Instant::now();',
    cleanNeedle: 'pub fn span_probe_caller() -> u64 {',
    text: [
      '',
      '/// Probe for the v61 host tier.',
      '///',
      '/// Takes two bounds and adds them.',
      'pub fn span_probe(first: u64, second: u64) -> u64 {',
      '    let c80_started = std::time::Instant::now();',
      '    first + second + c80_started.elapsed().as_secs()',
      '}',
      '',
      '/// Adds the two bounds the probe was built to add.',
      'pub fn span_probe_caller() -> u64 {',
      '    span_probe(1, 2)',
      '}',
      '',
      `// ${MARKER}`,
      '',
    ].join('\n'),
  },
  go: {
    file: 'playground/fim.go',
    name: 'SpanProbe',
    docNeedle: 'SpanProbe is a probe for the v61 host tier.',
    cursorNeedle: 'c80Started := time.Now()',
    cleanNeedle: 'func SpanProbeCaller() int64 {',
    text: [
      '',
      '// SpanProbe is a probe for the v61 host tier.',
      '//',
      '// It takes two bounds and adds them.',
      'func SpanProbe(first int64, second int64) int64 {',
      '\tc80Started := time.Now()',
      '\treturn first + second + c80Started.Unix()',
      '}',
      '',
      '// SpanProbeCaller adds the two bounds the probe was built to add.',
      'func SpanProbeCaller() int64 {',
      '\treturn SpanProbe(1, 2)',
      '}',
      '',
      `// ${MARKER}`,
      '',
    ].join('\n'),
  },
  python: {
    // NOT `playground/fim.py`, and the reason is checked into that file: its
    // line 52 is a deliberately unclosed `stripe.enroll_tile(`, an anchor the
    // sticky-selection suite needs. The file does not parse, so Pylance reads
    // everything appended below it as part of that unterminated call and hands
    // back `gesture_site` for a cursor a hundred lines lower. A target for an
    // insertion has to be a file that parses.
    file: 'playground/fns.py',
    name: 'span_probe',
    docNeedle: 'Probe for the v61 host tier.',
    cursorNeedle: 'c80_started = time.time()',
    cleanNeedle: 'def span_probe_caller() -> int:',
    text: [
      '',
      '',
      'def span_probe(first: int, second: int) -> int:',
      '    """Probe for the v61 host tier.',
      '',
      '    Takes two bounds and adds them.',
      '    """',
      '    import time',
      '',
      '    c80_started = time.time()',
      '    return first + second + int(c80_started)',
      '',
      '',
      'def span_probe_caller() -> int:',
      '    """Add the two bounds the probe was built to add."""',
      '    return span_probe(1, 2)',
      '',
      '',
      `# ${MARKER}`,
      '',
    ].join('\n'),
  },
  csharp: {
    file: 'src/Playground/Fim.cs',
    name: 'SpanProbe',
    docNeedle: 'Probe for the v61 host tier.',
    cursorNeedle: 'var c80Started = System.DateTime.UtcNow;',
    cleanNeedle: 'public static long SpanProbeCaller()',
    text: [
      '',
      'public static class C80V61Probe',
      '{',
      '    /// <summary>Probe for the v61 host tier.</summary>',
      '    /// <param name="first">the first bound</param>',
      '    /// <param name="second">the second bound</param>',
      '    public static long SpanProbe(long first, long second)',
      '    {',
      '        var c80Started = System.DateTime.UtcNow;',
      '        return first + second + c80Started.Ticks;',
      '    }',
      '',
      '    /// <summary>Adds the two bounds the probe was built to add.</summary>',
      '    public static long SpanProbeCaller()',
      '    {',
      '        return SpanProbe(1, 2);',
      '    }',
      '}',
      '',
      `// ${MARKER}`,
      '',
    ].join('\n'),
  },
};


module.exports = { FIXTURES, MARKER };
