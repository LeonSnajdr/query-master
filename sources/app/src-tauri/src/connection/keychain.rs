//! Connection strings in the keychain of the operating system, one entry per connection.

use uuid::Uuid;

use crate::error::{Error, Result};

const SERVICE: &str = "QueryMaster";

fn entry(id: Uuid) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, &id.to_string()).map_err(Error::Keychain)
}

pub fn read(id: Uuid) -> Result<String> {
    entry(id)?.get_password().map_err(Error::KeychainRead)
}

pub fn write(id: Uuid, uri: &str) -> Result<()> {
    entry(id)?.set_password(uri).map_err(Error::KeychainWrite)
}

/// An entry that is already gone (removed by hand) counts as deleted.
pub fn delete(id: Uuid) -> Result<()> {
    match entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(Error::Keychain(error)),
    }
}

/// The password or key passphrase of a connection's SSH server, in an entry of its own.
fn ssh_entry(id: Uuid) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, &format!("{id}.ssh")).map_err(Error::Keychain)
}

/// An entry that is not there is an empty secret: a key without a passphrase.
pub fn read_ssh(id: Uuid) -> Result<String> {
    match ssh_entry(id)?.get_password() {
        Ok(secret) => Ok(secret),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(error) => Err(Error::KeychainRead(error)),
    }
}

/// Stores the secret; an empty one removes the entry.
pub fn write_ssh(id: Uuid, secret: &str) -> Result<()> {
    if secret.is_empty() {
        return delete_ssh(id);
    }
    ssh_entry(id)?
        .set_password(secret)
        .map_err(Error::KeychainWrite)
}

pub fn delete_ssh(id: Uuid) -> Result<()> {
    match ssh_entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(Error::Keychain(error)),
    }
}
