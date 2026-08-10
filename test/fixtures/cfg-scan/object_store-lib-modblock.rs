//! application complexity.
//!
//! ```no_run,ignore-wasm32
//! # #[cfg(feature = "aws")] {
//! # use url::Url;
//! # use object_store::{parse_url, parse_url_opts};
//! # use object_store::aws::{AmazonS3, AmazonS3Builder};
//! #
//! These could be a custom CA chain, or alternatively an alternative trust store, e.g. [`webpki-roots`].
//!
//! ```ignore-wasm32
//! # #[cfg(feature = "aws")] {
//! use object_store::{ClientOptions, Certificate};
//!
//! let mut options = ClientOptions::default().with_no_system_certificates(true);
//! for root_cert in webpki_root_certs::TLS_SERVER_ROOT_CERTS {
//!     options = options.with_root_certificate(Certificate::from_der(root_cert.as_ref()).unwrap());
//! }
//! # }
//! ```
//!
//! [CA]: https://en.wikipedia.org/wiki/Certificate_authority
//! [`rustls-platform-verifier`]: https://crates.io/crates/rustls-platform-verifier/
//! [`webpki-roots`]: https://crates.io/crates/webpki-roots
//!
//! # Customizing HTTP Clients
//!
//! Many [`ObjectStore`] implementations permit customization of the HTTP client via
//! the [`HttpConnector`] trait and utilities in the [`client`] module.
//! Examples include injecting custom HTTP headers or using an alternate
//! tokio Runtime for I/O requests. To replace `reqwest` entirely (rather than
//! tweak the bundled transport) see [Disabling `reqwest`](#disabling-reqwest).
//!
//! [`HttpConnector`]: client::HttpConnector
//!
//! # Disabling `reqwest`
//!
//! The `aws`, `azure`, `gcp`, and `http` features each bundle a
//! [`reqwest`]-based HTTP transport, which is the right choice for most
//! applications. If you would rather supply your own HTTP client — for example
//! to share an existing client, to target a platform where `reqwest` does not
//! compile (such as `wasm32-wasip1`), or to keep `reqwest` out of your
//! dependency tree — use the matching `*-base` feature and provide an
//! [`HttpConnector`](client::HttpConnector) at builder time.
//!
//! Remember to disable the default features so that `fs` (and its transitive
//! dependencies) is not pulled in:
//!
//! ```toml
//! [dependencies]
//! object_store = { version = "0.13", default-features = false, features = ["aws-base"] }
//! ```
//!
//! ```ignore
//! use object_store::aws::AmazonS3Builder;
//!
//! let store = AmazonS3Builder::from_env()
//!     // `my_connector` is your own `impl HttpConnector`
//!     .with_http_connector(my_connector)
//!     .build()?;
//! ```
//!
//! See [Feature Flags](#feature-flags) above for the full set of flags.
//!
//! [`reqwest`]: https://crates.io/crates/reqwest

#[cfg(feature = "aws-base")]
pub mod aws;
#[cfg(feature = "azure-base")]
pub mod azure;
#[cfg(feature = "tokio")]
pub mod buffered;
#[cfg(not(target_arch = "wasm32"))]
pub mod chunked;
pub mod delimited;
#[cfg(feature = "gcp-base")]
pub mod gcp;
#[cfg(feature = "http-base")]
pub mod http;
#[cfg(feature = "tokio")]
pub mod limit;
#[cfg(all(feature = "fs", not(target_arch = "wasm32")))]
pub mod local;
pub mod memory;
pub mod path;
pub mod prefix;
pub mod registry;
#[cfg(feature = "cloud-base")]
pub mod signer;
#[cfg(feature = "tokio")]
pub mod throttle;

#[cfg(feature = "cloud-base")]
pub mod client;

#[cfg(feature = "cloud-base")]
pub use client::{
    ClientConfigKey, ClientOptions, CredentialProvider, StaticCredentialProvider,
    backoff::BackoffConfig, retry::RetryConfig,
};

#[cfg(all(
    feature = "cloud-base",
    feature = "reqwest",
    not(target_arch = "wasm32")
))]
pub use client::Certificate;

#[cfg(feature = "cloud-base")]
mod config;

mod tags;

pub use tags::TagSet;

pub mod list;
pub mod multipart;
mod parse;
mod payload;
mod upload;
mod util;

mod attributes;

#[cfg(any(feature = "integration", test))]
pub mod integration;

pub use attributes::*;

