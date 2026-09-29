// Hand-written types, no macro. The outline sees these.

// Every function qualifier rust-analyzer prints in a completion detail.
pub struct Gauge {
    level: u32,
}

impl Gauge {
    pub const fn empty() -> Self {
        Gauge { level: 0 }
    }

    pub fn level(&self) -> u32 {
        self.level
    }

    pub unsafe fn level_unchecked(&self) -> u32 {
        self.level
    }

    pub async fn settle(&self) -> u32 {
        self.level
    }

    pub const unsafe fn from_raw(level: u32) -> Self {
        Gauge { level }
    }
}

// A tuple struct whose field IS public: `OpenId(7)` is a legal construction.
pub struct OpenId(pub u128);

// A tuple struct whose field is private, written by hand.
pub struct SealedId(u128);

impl SealedId {
    pub fn new(raw: u128) -> Self {
        SealedId(raw)
    }
}
