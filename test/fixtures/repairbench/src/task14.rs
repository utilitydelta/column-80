pub fn rotate_left_in_place(v: &mut Vec<i32>, k: usize) {
    if v.is_empty() {
        return;
    }
    
    let len = v.len();
    let k = k % len;
    
    if k == 0 {
        return;
    }
    
    // Reverse the entire vector
    v.reverse();
    
    // Reverse the first (len - k) elements
    v[0..(len - k)].reverse();
    
    // Reverse the remaining elements
    v[(len - k)..len].reverse();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let mut v = vec![1, 2, 3, 4, 5];
        rotate_left_in_place(&mut v, 2);
        assert_eq!(v, vec![3, 4, 5, 1, 2]);
    }
    #[test]
    fn k_wraps() {
        let mut v = vec![1, 2, 3, 4, 5];
        rotate_left_in_place(&mut v, 7);
        assert_eq!(v, vec![3, 4, 5, 1, 2]);
    }
    #[test]
    fn empty_no_panic() {
        let mut v: Vec<i32> = vec![];
        rotate_left_in_place(&mut v, 3);
        assert_eq!(v, Vec::<i32>::new());
    }
    #[test]
    fn k_equals_len_noop() {
        let mut v = vec![1, 2];
        rotate_left_in_place(&mut v, 2);
        assert_eq!(v, vec![1, 2]);
    }
}
