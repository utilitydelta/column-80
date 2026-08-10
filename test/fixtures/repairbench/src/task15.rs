#[allow(unused_variables)]
pub struct Countdown {
    pub remaining: u32,
}

impl Iterator for Countdown {
    type Item = u32;
    fn next(&mut self) -> Option<u32> { unimplemented!() }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_down_to_one() {
        let v: Vec<u32> = Countdown { remaining: 3 }.collect();
        assert_eq!(v, vec![3, 2, 1]);
    }
    #[test]
    fn zero_is_empty() {
        let v: Vec<u32> = Countdown { remaining: 0 }.collect();
        assert_eq!(v, Vec::<u32>::new());
    }
    #[test]
    fn size_hint_exact() {
        assert_eq!(Countdown { remaining: 4 }.size_hint(), (4, Some(4)));
    }
}
