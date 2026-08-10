// Oracle fixture (v7 scout): the CONSUMER. Imports the domain from domain.rs and
// writes whole-block LINQ over it. The `resolveStruct` edge-resolver, anchored at
// a cursor in one of these bodies (or at the param type in the signature), must
// derive Order's cross-file shape to depth 2 (Order -> Customer -> Address, plus
// Order/Customer/LineItem methods). None of these defs are in THIS file: that is
// the point. Bodies are the correct reference; the oracle blanks them to todo!().
#![allow(dead_code, unused)]

use crate::domain::{Address, Customer, LineItem, Order};

/// Distinct customer towns across all orders. Correct path: placed_by.ship_to.locale.
pub fn distinct_locales(orders: &[Order]) -> std::collections::HashSet<String> {
    orders.iter().map(|o| o.placed_by.ship_to.locale.clone()).collect()
}

/// Gross net value across all orders. Correct: o.net_minor_units() (a method).
pub fn gross_minor_units(orders: &[Order]) -> u64 {
    orders.iter().map(|o| o.net_minor_units()).sum()
}

/// Names of patron customers. Correct: filter(is_patron()) + display_name.
pub fn patron_names(orders: &[Order]) -> Vec<String> {
    orders
        .iter()
        .filter(|o| o.placed_by.is_patron())
        .map(|o| o.placed_by.display_name.clone())
        .collect()
}
