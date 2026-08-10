pub fn chunk_sums(nums: &[i64], k: usize) -> Vec<i64> {
    if k == 0 || nums.is_empty() {
        return vec![];
    }
    
    let mut result = Vec::new();
    let mut sum = 0i64;
    let mut count = 0;
    
    for &num in nums {
        sum += num;
        count += 1;
        
        if count == k {
            result.push(sum);
            sum = 0;
            count = 0;
        }
    }
    
    // Handle the final chunk if it's not empty
    if count > 0 {
        result.push(sum);
    }
    
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic_with_tail() { assert_eq!(chunk_sums(&[1, 2, 3, 4, 5], 2), vec![3, 7, 5]); }
    #[test]
    fn k_zero_or_empty() {
        assert_eq!(chunk_sums(&[1, 2], 0), Vec::<i64>::new());
        assert_eq!(chunk_sums(&[], 3), Vec::<i64>::new());
    }
    #[test]
    fn k_exceeds_len() { assert_eq!(chunk_sums(&[1, 2], 5), vec![3]); }
}
