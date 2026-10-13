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
