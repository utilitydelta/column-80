pub fn split_csv_line(line: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    
    let mut chars = line.chars().peekable();
    
    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                if in_quotes {
                    // Check if this is an escaped quote (two quotes)
                    if chars.peek() == Some(&'"') {
                        field.push('"');
                        chars.next(); // consume the next quote
                    } else {
                        // End of quoted field
                        in_quotes = false;
                    }
                } else {
                    // Start of quoted field
                    in_quotes = true;
                }
            }
            ',' => {
                if !in_quotes {
                    // End of field
                    result.push(field);
                    field = String::new();
                } else {
                    field.push(ch);
                }
            }
            _ => {
                field.push(ch);
            }
        }
    }
    
    // Add the last field
    result.push(field);
    
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plain_fields() {
        assert_eq!(split_csv_line("a,b,c"), vec!["a", "b", "c"]);
        assert_eq!(split_csv_line("a,,b"), vec!["a", "", "b"]);
    }
    #[test]
    fn quoted_comma() { assert_eq!(split_csv_line("\"a,b\",c"), vec!["a,b", "c"]); }
    #[test]
    fn escaped_quote() {
        assert_eq!(split_csv_line("\"he said \"\"hi\"\"\",x"), vec!["he said \"hi\"", "x"]);
    }
    #[test]
    fn empty_line() { assert_eq!(split_csv_line(""), vec![""]); }
}
