pub fn rle_encode(s: &str) -> String {
    if s.is_empty() {
        return String::new();
    }
    
    let mut result = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    
    while i < chars.len() {
        let current_char = chars[i];
        let mut count = 1;
        
        // Count consecutive occurrences
        while i + count < chars.len() && chars[i + count] == current_char {
            count += 1;
        }
        
        // Append character and count to result
        result.push(current_char);
        result.push_str(&count.to_string());
        
        // Move to next different character
        i += count;
    }
    
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic_runs() {
        assert_eq!(rle_encode("aaabb"), "a3b2");
        assert_eq!(rle_encode("abc"), "a1b1c1");
    }
    #[test]
    fn single_and_empty() {
        assert_eq!(rle_encode("a"), "a1");
        assert_eq!(rle_encode(""), "");
    }
    #[test]
    fn long_run() {
        assert_eq!(rle_encode("aaaaaaaaaaab"), "a11b1");
    }
}
