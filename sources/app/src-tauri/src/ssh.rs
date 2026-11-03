//! A connection through an SSH server: the database is reached from there. A local port forwards
//! to it over the SSH session (`direct-tcpip`), and the driver connects to that port.

use std::sync::Arc;

use russh::client;
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use crate::error::{Error, Result};

/// How the SSH server is logged in to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SshMethod {
    Password,
    Key,
}

/// The SSH part of a connection, as the dialog sends it and the keychain keeps its secret.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSettings {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub method: SshMethod,
    /// The private key file, with `Key`.
    #[serde(default)]
    pub key_path: String,
    /// The password, or with `Key` the passphrase of the key; empty for none.
    #[serde(default)]
    pub secret: String,
}

/// A local port that forwards to the database through the SSH session; closed when dropped.
pub struct Tunnel {
    pub local_port: u16,
    task: JoinHandle<()>,
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        self.task.abort();
    }
}

struct Handler;

impl client::Handler for Handler {
    type Error = russh::Error;

    // Every host key is taken (it is not verified yet); the server is the one the user typed.
    async fn check_server_key(
        &mut self,
        _key: &PublicKeyOrCertificate,
    ) -> std::result::Result<bool, Self::Error> {
        Ok(true)
    }
}

fn ssh_error(error: impl std::fmt::Display) -> Error {
    Error::Ssh(error.to_string())
}

/// Logs in to the SSH server and opens a local port that forwards to `target_host:target_port`
/// as the SSH server sees it.
pub async fn open(settings: &SshSettings, target_host: &str, target_port: u16) -> Result<Tunnel> {
    let config = Arc::new(client::Config {
        nodelay: true,
        ..Default::default()
    });
    let mut session = client::connect(config, (settings.host.trim(), settings.port), Handler)
        .await
        .map_err(ssh_error)?;
    let authenticated = match settings.method {
        SshMethod::Password => session
            .authenticate_password(settings.username.trim(), settings.secret.as_str())
            .await
            .map_err(ssh_error)?,
        SshMethod::Key => {
            let passphrase = (!settings.secret.is_empty()).then_some(settings.secret.as_str());
            let key = load_secret_key(settings.key_path.trim(), passphrase).map_err(ssh_error)?;
            let hash = session
                .best_supported_rsa_hash()
                .await
                .map_err(ssh_error)?
                .flatten();
            session
                .authenticate_publickey(
                    settings.username.trim(),
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await
                .map_err(ssh_error)?
        }
    };
    if !authenticated.success() {
        return Err(Error::SshAuthentication);
    }

    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let local_port = listener.local_addr()?.port();
    let session = Arc::new(session);
    let target_host = target_host.to_owned();
    let task = tokio::spawn(async move {
        while let Ok((mut socket, origin)) = listener.accept().await {
            let session = session.clone();
            let target_host = target_host.clone();
            tokio::spawn(async move {
                let Ok(channel) = session
                    .channel_open_direct_tcpip(
                        target_host,
                        target_port.into(),
                        origin.ip().to_string(),
                        origin.port().into(),
                    )
                    .await
                else {
                    return;
                };
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
            });
        }
    });
    Ok(Tunnel { local_port, task })
}
