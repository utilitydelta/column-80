// Oracle fixture (v7 scout): the CROSS-FILE domain. Defined here, consumed from
// consumer.rs. A headless RA oracle points at this two-file crate and asserts
// the cross-file `resolveStruct` edge-resolver derives the shape below WITHOUT
// the consumer file needing these defs in its own window. Non-guessable names
// (locale not city, net_minor_units not total) prove derivation, not memory.
#![allow(dead_code, unused)]

pub struct Address {
    pub locale: String,
    pub postcode: u32,
    pub region: Region,
}

pub struct Region {
    pub iso_code: String,
    pub tax_rate_bp: u32,
}

pub struct Customer {
    pub display_name: String,
    pub ship_to: Address,
    tier: u8,
}

impl Customer {
    pub fn is_patron(&self) -> bool {
        self.tier >= 2
    }
}

pub struct LineItem {
    pub sku: String,
    pub qty: u32,
    pub unit_minor_units: u64,
}

impl LineItem {
    pub fn extended_minor_units(&self) -> u64 {
        self.qty as u64 * self.unit_minor_units
    }
}

pub struct Order {
    pub reference: String,
    pub placed_by: Customer,
    pub entries: Vec<LineItem>,
}

impl Order {
    pub fn net_minor_units(&self) -> u64 {
        self.entries.iter().map(|e| e.extended_minor_units()).sum()
    }
}
