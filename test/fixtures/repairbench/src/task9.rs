pub fn parse_port(line: usize, s: &str) -> Result<u16, String> {
    let trimmed = s.trim();
    
    if trimmed.is_empty() {
        return Err(format!("line {line}: missing value"));
    }
    
    let port = trimmed.parse::<u32>()
        .map_err(|_| format!("line {line}: invalid port '{trimmed}'"))?;
    
    if port == 0 {
        return Err(format!("line {line}: port must be nonzero"));
    }
    
    if port > 65535 {
        return Err(format!("line {line}: invalid port '{trimmed}'"));
    }
    
    Ok(port as u16)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ok_with_whitespace() { assert_eq!(parse_port(3, " 8080 "), Ok(8080)); }
    #[test]
    fn missing() {
        assert_eq!(parse_port(1, ""), Err("line 1: missing value".to_string()));
        assert_eq!(parse_port(1, "   "), Err("line 1: missing value".to_string()));
    }
    #[test]
    fn invalid() {
        assert_eq!(parse_port(2, "abc"), Err("line 2: invalid port 'abc'".to_string()));
        assert_eq!(parse_port(4, "70000"), Err("line 4: invalid port '70000'".to_string()));
    }
    #[test]
    fn zero() { assert_eq!(parse_port(5, "0"), Err("line 5: port must be nonzero".to_string())); }
}
