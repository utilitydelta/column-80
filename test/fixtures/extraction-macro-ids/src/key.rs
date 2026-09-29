use crate::ids::{GhostId, StreamId, TenantId};

pub struct StreamKey {
    pub tenant: TenantId,
    pub stream: StreamId,
    pub ghost: GhostId,
}

impl StreamKey {
    pub fn new(tenant: TenantId, stream: StreamId, ghost: GhostId) -> Self {
        StreamKey { tenant, stream, ghost }
    }

    pub fn is_blank(&self) -> bool {
        self.tenant.is_sentinel() && self.stream.is_sentinel()
    }
}

// The existing `Type::` paths the fallback completes at. TenantId and StreamId
// have one each; GhostId has none anywhere in the crate.
pub fn first_tenant() -> TenantId {
    TenantId::new(1)
}

pub fn blank_stream() -> StreamId {
    StreamId::SENTINEL
}

pub fn describe(key: &StreamKey) -> u128 {
    key.tenant.get() + key.stream.get()
}
