// Slice-2 behavioral-oracle template. The loop overwrites the region between the
// GEN markers with the model's bloom_demo(); the committed placeholder compiles
// clean and FAILS the behavior test, so a run that only compiles is not mistaken
// for a run that behaves. The behavior test is the falsification bar: a generated
// filter must report an inserted item present.
//
// The task the loop is given (signature + doc) is:
//   /// Build a bloom filter sized for roughly 1000 expected items, insert the
//   /// string "hello" into it, then return whether the filter reports "hello"
//   /// as present. Use the `fastbloom` crate (already a dependency).
//   fn bloom_demo() -> bool

use fastbloom::BloomFilter;

// GEN-START
fn bloom_demo() -> bool {
    let _ = BloomFilter::with_num_bits(1024);
    false
}
// GEN-END

fn main() {
    let _ = bloom_demo();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_inserted_item_present() {
        assert!(bloom_demo(), "the filter must report the inserted item present");
    }
}
