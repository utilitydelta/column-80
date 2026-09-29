// A newtype ID macro in the shape real Rust codebases use: the struct and its
// inherent impl both come from the expansion, so the file's outline holds the
// macro and the invocations and nothing else.
macro_rules! newtype_id {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub struct $name(u128);

        impl $name {
            pub const SENTINEL: Self = Self::new(0);

            #[inline]
            pub const fn new(raw: u128) -> Self {
                Self(raw)
            }

            #[inline]
            pub const fn get(self) -> u128 {
                self.0
            }

            #[inline]
            pub const fn is_sentinel(self) -> bool {
                self.get() == 0
            }
        }
    };
}

newtype_id!(TenantId);
newtype_id!(StreamId);
// Nothing in this crate spells a `GhostId::` path. It is the case a fallback
// that completes at an existing path cannot reach.
newtype_id!(GhostId);
