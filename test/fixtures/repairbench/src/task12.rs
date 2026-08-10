pub fn brace_depth_max(s: &str) -> Option<usize> {
    let mut depth = 0;
    let mut max_depth = 0;
    
    for c in s.chars() {
        match c {
            '{' => {
                depth += 1;
                max_depth = max_depth.max(depth);
            }
            '}' => {
                if depth == 0 {
                    return None;
                }
                depth -= 1;
            }
            _ => {}
        }
    }
    
    if depth != 0 {
        None
    } else {
        Some(max_depth)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nested() {
        assert_eq!(brace_depth_max("{}{{}}"), Some(2));
        assert_eq!(brace_depth_max("a{b{c}d}e"), Some(2));
    }
    #[test]
    fn empty_zero() { assert_eq!(brace_depth_max(""), Some(0)); }
    #[test]
    fn unbalanced() {
        assert_eq!(brace_depth_max("}{"), None);
        assert_eq!(brace_depth_max("{{{"), None);
    }
}
