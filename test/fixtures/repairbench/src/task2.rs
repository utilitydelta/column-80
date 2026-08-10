pub fn merge_sorted(a: &[i32], b: &[i32]) -> Vec<i32> {
    let mut result = Vec::with_capacity(a.len() + b.len());
    let mut i = 0;
    let mut j = 0;
    
    while i < a.len() && j < b.len() {
        if a[i] <= b[j] {
            result.push(a[i]);
            i += 1;
        } else {
            result.push(b[j]);
            j += 1;
        }
    }
    
    while i < a.len() {
        result.push(a[i]);
        i += 1;
    }
    
    while j < b.len() {
        result.push(b[j]);
        j += 1;
    }
    
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interleaved() {
        assert_eq!(merge_sorted(&[1, 3, 5], &[2, 4, 6]), vec![1, 2, 3, 4, 5, 6]);
    }
    #[test]
    fn one_empty() {
        assert_eq!(merge_sorted(&[], &[1, 2]), vec![1, 2]);
        assert_eq!(merge_sorted(&[1, 2], &[]), vec![1, 2]);
    }
    #[test]
    fn duplicates_kept() {
        assert_eq!(merge_sorted(&[1, 2, 2], &[2, 3]), vec![1, 2, 2, 2, 3]);
    }
}
