// Extraction fixture. Cursor sites the slice-1 live oracle drives rust-analyzer
// against; the committed form compiles clean. Ground-truth member and
// signature sets are documented in session/slice1-surface.md so the blind
// oracle asserts against known-correct values without reading the extractor.
//
// Site anchors are found by text search (the oracle locates `filter.insert`,
// `BloomFilter::with_num_bits`, `widget.render`), matching how the scout's
// ra_select.py located its cursor.

use fastbloom::BloomFilter;

// A local struct with deliberately non-obvious method names. Conventional-name
// guessing (`to_string`, `label`, `summary`) misses all three, so the
// direct-method signature extraction is what makes them reachable (finding 13).
pub struct Widget {
    seed: u64,
}

impl Widget {
    pub fn forge(seed: u64) -> Widget {
        Widget { seed }
    }

    pub fn render(&self) -> String {
        format!("widget-{}", self.seed)
    }

    pub fn relabel(&mut self, seed: u64) {
        self.seed = seed;
    }
}

// Builder chain through the macro-built fastbloom API. Site A queries members
// on `filter.` (receiver type inferred through the chain); site B queries the
// constructor path on `BloomFilter::`.
fn use_bloom() {
    let mut filter = BloomFilter::with_num_bits(1024).expected_items(2);
    filter.insert(&"a");
    let _ = filter.contains(&"a");
}

// Direct-method site: `widget.` resolves to the local Widget's inherent methods.
fn use_widget() {
    let mut widget = Widget::forge(7);
    widget.relabel(9);
    let _ = widget.render();
}

fn main() {
    use_bloom();
    use_widget();
}
