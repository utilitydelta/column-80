pub fn sum_lines(text: &str) -> Result<i64, (usize, String)> {
    let mut sum = 0i64;
    for (line_number, line) in text.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match trimmed.parse::<i64>() {
            Ok(value) => sum += value,
            Err(_) => return Err((line_number + 1, trimmed.to_string())),
        }
    }
    Ok(sum)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sums() { assert_eq!(sum_lines("1\n2\n3"), Ok(6)); }
    #[test]
    fn blanks_skipped_whitespace_trimmed() { assert_eq!(sum_lines("1\n\n 2 "), Ok(3)); }
    #[test]
    fn first_bad_line_reported() { assert_eq!(sum_lines("1\nx7\n3"), Err((2, "x7".to_string()))); }
    #[test]
    fn negatives() { assert_eq!(sum_lines("-5\n2"), Ok(-3)); }
}
