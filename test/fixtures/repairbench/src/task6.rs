pub fn longest_run(s: &str) -> &str {
    if s.is_empty() {
        return "";
    }
    
    let mut best_start = 0;
    let mut best_len = 1;
    let mut start = 0;
    let mut len = 1;
    
    let bytes = s.as_bytes();
    for i in 1..bytes.len() {
        if bytes[i] == bytes[i-1] {
            len += 1;
        } else {
            if len > best_len {
                best_len = len;
                best_start = start;
            }
            start = i;
            len = 1;
        }
    }
    
    if len > best_len {
        best_len = len;
        best_start = start;
    }
    
    &s[best_start..best_start + best_len]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() { assert_eq!(longest_run("aabbbcc"), "bbb"); }
    #[test]
    fn tie_takes_first() { assert_eq!(longest_run("aabb"), "aa"); }
    #[test]
    fn empty_and_single() {
        assert_eq!(longest_run(""), "");
        assert_eq!(longest_run("z"), "z");
    }
}
