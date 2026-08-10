/// Parses a duration string like "30s", "5m", or "2h" into total seconds.
/// Supports suffixes: 's' (seconds), 'm' (minutes), 'h' (hours).
/// Returns None for empty input, unknown suffixes, or a non-numeric amount.
pub fn parse_duration(s: &str) -> Option<u64> {
    if s.is_empty() {
        return None;
    }
    
    let (number_str, suffix) = s.split_at(s.len() - 1);
    
    let number = number_str.parse::<u64>().ok()?;
    
    match suffix {
        "s" => Some(number),
        "m" => Some(number * 60),
        "h" => Some(number * 3600),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_each_unit() {
        assert_eq!(parse_duration("30s"), Some(30));
        assert_eq!(parse_duration("5m"), Some(300));
        assert_eq!(parse_duration("2h"), Some(7200));
    }
    #[test]
    fn rejects_bad_input() {
        assert_eq!(parse_duration(""), None);
        assert_eq!(parse_duration("abc"), None);
        assert_eq!(parse_duration("10x"), None);
    }
    #[test]
    fn zero_ok() {
        assert_eq!(parse_duration("0s"), Some(0));
    }
}
