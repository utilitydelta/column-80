/// Adds two counters. The `let sum` line is the breakage anchor the
/// phase-4 tests mutate on scratch copies; committed form compiles clean.
pub fn add_counts(a: u64, b: u64) -> u64 {
    let sum: u64 = a + b;
    sum
}
