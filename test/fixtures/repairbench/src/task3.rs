/// LRU touch: moves `key` to the front of `order` (index 0, the
/// most-recently-used position), preserving the relative order of the
/// other elements. If `key` is not present, inserts it at the front.
pub fn lru_touch(order: &mut Vec<u32>, key: u32) {
    if let Some(pos) = order.iter().position(|&k| k == key) {
        order.remove(pos);
    }
    order.insert(0, key);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn moves_existing_to_front() {
        let mut v = vec![1, 2, 3, 4];
        lru_touch(&mut v, 3);
        assert_eq!(v, vec![3, 1, 2, 4]);
    }
    #[test]
    fn absent_key_inserted_at_front() {
        let mut v = vec![1, 2];
        lru_touch(&mut v, 9);
        assert_eq!(v, vec![9, 1, 2]);
    }
    #[test]
    fn front_key_stays() {
        let mut v = vec![7, 8];
        lru_touch(&mut v, 7);
        assert_eq!(v, vec![7, 8]);
    }
}
