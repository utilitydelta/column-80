#[allow(unused_variables)]
/// Returns the longest string in `words` (by byte length), or None if
/// the slice is empty. On ties the FIRST longest wins. The returned
/// reference must borrow from the underlying strings ('a), not from
/// the temporary slice.
pub fn max_by_len<'a>(words: &[&'a str]) -> Option<&'a str> { unimplemented!() }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn longest_wins() { assert_eq!(max_by_len(&["a", "bbb", "cc"]), Some("bbb")); }
    #[test]
    fn tie_takes_first() { assert_eq!(max_by_len(&["aa", "bb"]), Some("aa")); }
    #[test]
    fn empty_none() { assert_eq!(max_by_len(&[]), None); }
}
