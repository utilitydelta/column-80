/// Splits a config line "key=value" on the FIRST '=' and returns the
/// key and value with surrounding whitespace trimmed.
/// Returns None if the line contains no '=' or the trimmed key is empty.
/// The value may be empty. Later '=' characters belong to the value.
pub fn split_key_value(line: &str) -> Option<(&str, &str)> {
    let pos = line.find('=')?;
    let (key, value) = line.split_at(pos);
    let key = key.trim();
    let value = &value[1..].trim();
    
    if key.is_empty() {
        None
    } else {
        Some((key, value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic_and_trimmed() {
        assert_eq!(split_key_value("a=b"), Some(("a", "b")));
        assert_eq!(split_key_value("  host =  local  "), Some(("host", "local")));
    }
    #[test]
    fn first_equals_wins() {
        assert_eq!(split_key_value("url=http://x?a=1"), Some(("url", "http://x?a=1")));
    }
    #[test]
    fn rejects_missing_or_empty_key() {
        assert_eq!(split_key_value("no separator"), None);
        assert_eq!(split_key_value("  =value"), None);
    }
    #[test]
    fn empty_value_ok() {
        assert_eq!(split_key_value("key="), Some(("key", "")));
    }
}
