pub fn running_avg(xs: &[f64], window: usize) -> Vec<f64> {
    if window == 0 {
        return vec![];
    }
    
    let mut result = Vec::with_capacity(xs.len());
    let mut sum = 0.0;
    let mut count = 0;
    
    for &x in xs {
        sum += x;
        count += 1;
        
        if count > window {
            // Remove the oldest element from the window
            sum -= xs[count - window - 1];
        }
        
        result.push(sum / count.min(window) as f64);
    }
    
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn window_two() { assert_eq!(running_avg(&[2.0, 4.0, 6.0, 8.0], 2), vec![2.0, 3.0, 5.0, 7.0]); }
    #[test]
    fn warm_up_prefix() { assert_eq!(running_avg(&[3.0, 6.0], 3), vec![3.0, 4.5]); }
    #[test]
    fn window_one_is_identity() { assert_eq!(running_avg(&[1.5, 2.5], 1), vec![1.5, 2.5]); }
    #[test]
    fn window_zero_empty() { assert_eq!(running_avg(&[1.0], 0), Vec::<f64>::new()); }
}
