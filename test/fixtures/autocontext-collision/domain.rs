// Collision fixture. `inner::Widget` appears FIRST textually; the crate-level
// `Widget` appears SECOND. `Container.panel: Widget` refers to the crate-level
// one. Non-guessable field/method names disambiguate which type was resolved.
#![allow(dead_code, unused)]

pub mod inner {
    // This Widget is defined BEFORE the crate-level one. A bare-name text search
    // for "Widget" lands here first - the wrong-type trap.
    pub struct Widget {
        pub inner_only_field: u32,
    }
    impl Widget {
        pub fn inner_only_method(&self) -> u32 {
            self.inner_only_field
        }
    }
}

// Decoy: the type name "Panel" appears in THIS comment and the string below
// before Panel's own definition, to probe the string/comment anchoring (finding
// 3). "Panel" must still resolve to the real struct, not the comment/string.
pub struct Panel {
    pub outer_only_field: String,
}
impl Panel {
    pub fn outer_only_method(&self) -> bool {
        !self.outer_only_field.is_empty()
    }
}

// The crate-level Widget (SECOND textually). Its field is `crate_widget_field`.
pub struct Widget {
    pub crate_widget_field: String,
    pub decoy: &'static str,
}
impl Widget {
    pub fn crate_widget_method(&self) -> usize {
        self.crate_widget_field.len()
    }
}

pub struct Container {
    // panel resolves to the crate-level Panel; label mentions "Panel" in a string.
    pub label: &'static str,
    pub panel: Panel,
    // widget resolves to the CRATE-LEVEL Widget, NOT inner::Widget.
    pub widget: Widget,
}
