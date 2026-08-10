// Consumes Container from domain.rs. The resolver anchors at the Container param
// and must derive Container -> {panel: Panel, widget: Widget(crate-level)}.
#![allow(dead_code, unused)]

use crate::domain::Container;

pub fn read_container(c: &Container) -> usize {
    todo!()
}
